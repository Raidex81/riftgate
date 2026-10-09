// Riftgate — vault Edge Function
//
// Every Vault file transfer goes through here. The "riftgate-shares" bucket is
// private with no storage policies (migration 0001), so the publishable key in
// the app can't read, write or list it. This function checks the account
// password through the database, then uses the service-role key to hand out
// short-lived signed links or to delete stored files.
//
// POST { action, username, password, ... }
//   upload-start    { filename, size }                      -> { success, storagePath, uploadUrl }
//   upload-finish   { storagePath, filename, description, expiresHours } -> { success, file }
//   download-url    { storagePath, expiresIn? }             -> { success, url }
//   delete          { fileId, adminPassword? }              -> { success }
//   cleanup-expired {}                                      -> { success, cleaned }
//   force-clean     {}  (admin)                             -> { success, cleaned }
//
// Needs migration 0007 (vault_record_upload, force_clean_shared_folder,
// vault_orphan_paths). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// provided to every Edge Function automatically.
// "Verify JWT" setting: same as media-proxy / account-email.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "riftgate-shares";
const MAX_BYTES = 50 * 1024 * 1024;

const JSON_HEADERS = { "Content-Type": "application/json" };
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const STORAGE_PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,100}$/;
const EXPIRY_HOURS = [1, 2, 4, 8, 12, 24];

// Messages from the database that are safe to show the user as-is.
const USER_FACING_ERRORS = [
  "Not authorized",
  "Expiration must be 1, 2, 4, 8, 12, or 24 hours",
  "Invalid storage path",
  "Invalid file name",
  "Description is too long",
  "That upload was already recorded",
  "Upload not found",
  "File is larger than 50 MB",
];

// Best-effort per-IP limit (per function instance): 60 requests / 10 minutes.
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 60;
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function serviceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...extra };
}

// Calls a database function. Returns { ok, data } or { ok:false, error } where
// error is a user-facing message.
async function rpc(fn: string, args: Record<string, unknown>): Promise<{ ok: boolean; data?: any; error?: string }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: serviceHeaders(JSON_HEADERS),
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const message = parsed && typeof parsed.message === "string" ? parsed.message : "";
    if (USER_FACING_ERRORS.includes(message)) return { ok: false, error: message };
    console.error(`[vault] ${fn} returned ${res.status}:`, text.slice(0, 500));
    return { ok: false, error: "The Vault couldn't do that right now — try again in a moment." };
  }
  return { ok: true, data: parsed };
}

async function removeObjects(paths: string[]): Promise<void> {
  const clean = paths.filter((p) => typeof p === "string" && STORAGE_PATH_RE.test(p));
  if (clean.length === 0) return;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: serviceHeaders(JSON_HEADERS),
    body: JSON.stringify({ prefixes: clean }),
  });
  if (!res.ok) console.error("[vault] storage delete failed:", res.status, (await res.text()).slice(0, 500));
}

function safeFileName(name: string): string {
  const base = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "");
  return (base || "file").slice(0, 100);
}

function str(v: unknown, max: number): string {
  return typeof v === "string" && v.length <= max ? v : "";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply({ error: "Use POST" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return reply({ success: false, error: "Server is not configured." }, 500);
  if (Number(req.headers.get("content-length") ?? "0") > 8192) return reply({ error: "Request too large." }, 413);

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) return reply({ success: false, error: "Too many requests — try again in a few minutes." }, 429);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply({ error: "Invalid JSON body" }, 400);
  }

  const action = body.action;
  const username = str(body.username, 20);
  const password = str(body.password, 200);
  if (!USERNAME_RE.test(username) || !password) {
    return reply({ success: false, error: "Not authorized" });
  }

  if (action === "upload-start") {
    const filename = str(body.filename, 255);
    const size = Number(body.size);
    if (!filename) return reply({ success: false, error: "Invalid file name" });
    if (!Number.isFinite(size) || size <= 0) return reply({ success: false, error: "That file is empty." });
    if (size > MAX_BYTES) return reply({ success: false, error: "File is larger than 50 MB" });

    const access = await rpc("check_share_access", { p_username: username, p_password: password });
    if (!access.ok) return reply({ success: false, error: access.error });
    if (access.data !== true) return reply({ success: false, error: "Not authorized" });

    const storagePath = `${crypto.randomUUID()}-${safeFileName(filename)}`;
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${storagePath}`, {
      method: "POST",
      headers: serviceHeaders(JSON_HEADERS),
      body: "{}",
    });
    const text = await res.text();
    let signed: any = null;
    try { signed = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok || !signed || typeof signed.url !== "string") {
      console.error("[vault] signed upload URL failed:", res.status, text.slice(0, 500));
      return reply({ success: false, error: "Couldn't start the upload — try again in a moment." });
    }
    return reply({ success: true, storagePath, uploadUrl: `${SUPABASE_URL}/storage/v1${signed.url}` });
  }

  if (action === "upload-finish") {
    const storagePath = str(body.storagePath, 200);
    const expiresHours = Number(body.expiresHours);
    if (!STORAGE_PATH_RE.test(storagePath)) return reply({ success: false, error: "Invalid storage path" });
    if (!EXPIRY_HOURS.includes(expiresHours)) {
      return reply({ success: false, error: "Expiration must be 1, 2, 4, 8, 12, or 24 hours" });
    }
    const recorded = await rpc("vault_record_upload", {
      p_username: username,
      p_password: password,
      p_filename: str(body.filename, 255),
      p_storage_path: storagePath,
      p_description: str(body.description, 500) || null,
      p_expires_hours: expiresHours,
    });
    if (!recorded.ok) {
      // Only an oversized upload is removed here; anything else (e.g. "already
      // recorded") might be someone else's file.
      if (recorded.error === "File is larger than 50 MB") await removeObjects([storagePath]);
      return reply({ success: false, error: recorded.error });
    }
    return reply({ success: true, file: recorded.data });
  }

  if (action === "download-url") {
    const storagePath = str(body.storagePath, 200);
    if (!STORAGE_PATH_RE.test(storagePath)) return reply({ success: false, error: "Not authorized" });
    const list = await rpc("get_shared_files", { p_username: username, p_password: password });
    if (!list.ok) return reply({ success: false, error: list.error });
    const allowed = Array.isArray(list.data) && list.data.some((f: any) => f && f.storage_path === storagePath);
    if (!allowed) return reply({ success: false, error: "Not authorized" });

    const expiresIn = Math.min(3600, Math.max(60, Number(body.expiresIn) || 300));
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${storagePath}`, {
      method: "POST",
      headers: serviceHeaders(JSON_HEADERS),
      body: JSON.stringify({ expiresIn }),
    });
    const text = await res.text();
    let signed: any = null;
    try { signed = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok || !signed || typeof signed.signedURL !== "string") {
      console.error("[vault] signed download URL failed:", res.status, text.slice(0, 500));
      return reply({ success: false, error: "Couldn't create a download link — the file may have expired." });
    }
    return reply({ success: true, url: `${SUPABASE_URL}/storage/v1${signed.signedURL}` });
  }

  if (action === "delete") {
    const fileId = Number(body.fileId);
    if (!Number.isSafeInteger(fileId) || fileId <= 0) return reply({ success: false, error: "Not authorized" });
    const lookup = await fetch(
      `${SUPABASE_URL}/rest/v1/shared_files?id=eq.${fileId}&select=storage_path`,
      { headers: serviceHeaders() },
    );
    const rows = lookup.ok ? await lookup.json() : [];
    const storagePath = Array.isArray(rows) && rows[0] ? rows[0].storage_path : null;

    const adminPassword = str(body.adminPassword, 200);
    const deleted = await rpc("delete_shared_file", {
      p_username: username,
      p_file_id: fileId,
      p_admin_password: adminPassword || null,
      p_password: adminPassword ? null : password,
    });
    if (!deleted.ok) return reply({ success: false, error: deleted.error });
    if (deleted.data !== true) return reply({ success: false, error: "Not authorized" });
    if (storagePath) await removeObjects([storagePath]);
    return reply({ success: true });
  }

  if (action === "cleanup-expired") {
    const expired = await rpc("cleanup_expired_shared_files", { p_username: username, p_password: password });
    if (!expired.ok) return reply({ success: false, error: expired.error });
    const paths = (Array.isArray(expired.data) ? expired.data : []).map((f: any) => f && f.storage_path);
    const orphans = await rpc("vault_orphan_paths", {});
    if (orphans.ok && Array.isArray(orphans.data)) paths.push(...orphans.data);
    await removeObjects(paths);
    return reply({ success: true, cleaned: Array.isArray(expired.data) ? expired.data.length : 0 });
  }

  if (action === "force-clean") {
    const cleaned = await rpc("force_clean_shared_folder", { p_admin_username: username, p_admin_password: password });
    if (!cleaned.ok) return reply({ success: false, error: cleaned.error });
    const paths = (Array.isArray(cleaned.data) ? cleaned.data : []).map((f: any) => f && f.storage_path);
    const orphans = await rpc("vault_orphan_paths", {});
    if (orphans.ok && Array.isArray(orphans.data)) paths.push(...orphans.data);
    await removeObjects(paths);
    return reply({ success: true, cleaned: Array.isArray(cleaned.data) ? cleaned.data.length : 0 });
  }

  return reply({ error: "Unknown action" }, 400);
});
