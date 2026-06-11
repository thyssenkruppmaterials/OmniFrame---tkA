# Downloads

Binaries for distribution (such as `OmniFrame_Agent.exe`) are hosted on
**Supabase Storage** (bucket: `downloads`), not in this repo.

## Current Public Binaries

| File | Public URL |
|---|---|
| `OmniFrame_Agent.zip` | https://wncpqxwmbxjgxvrpcake.supabase.co/storage/v1/object/public/downloads/OmniFrame_Agent.zip |

The agent is packaged as a ZIP (containing `OmniFrame_Agent.exe`) so that
corporate CASB/SWG policies (e.g. Netskope FedRAMP) that block `.exe`
downloads allow the file through. Users extract the ZIP, then double-click
the .exe inside.

The web app (e.g. `src/features/admin/sap-testing/components/one-click-ship-tab.tsx`)
points `AGENT_DOWNLOAD_URL` at the Supabase public URL above.

## Updating the Agent Binary

1. Build on Windows: `cd omni_agent && build_exe.bat` (produces `dist/OmniFrame_Agent.exe`)
2. Package: `zip -j OmniFrame_Agent.zip dist/OmniFrame_Agent.exe`
3. Upload the new `OmniFrame_Agent.zip` to the `downloads` bucket via the
   Supabase Dashboard (Storage → downloads → Upload file), replacing the
   existing file. Keep the filename unchanged so the download URL stays
   the same.
4. No redeploy needed -- users get the new binary immediately.

Alternatively, upload via CLI (requires a service-role key or temporary
RLS INSERT policy on the `downloads` bucket):

```bash
curl -X POST \
  "https://wncpqxwmbxjgxvrpcake.supabase.co/storage/v1/object/downloads/OmniFrame_Agent.zip" \
  -H "apikey: <SERVICE_ROLE_KEY>" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/zip" \
  -H "x-upsert: true" \
  --data-binary "@OmniFrame_Agent.zip"
```

## Why Supabase Storage (Not Git)

- Git isn't meant for binary files (repo bloat, slow clones)
- Supabase Storage has a CDN, public URLs, and cache headers out of the box
- Updates don't require a Railway redeploy -- just re-upload the file
- The bucket is public-read, anon-insert locked (admins must re-enable
  temporary INSERT policies or use service-role keys to upload)
