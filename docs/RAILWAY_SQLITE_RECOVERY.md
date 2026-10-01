# Railway SQLite recovery runbook

This is an operator procedure for the `chat-ai` production volume. It does not restore anything by itself.

Status of the live backup schedule is `BACKUP_STATUS_UNVERIFIED` until an authorized Railway read shows the Backups tab. A passing synthetic SQLite test is `SYNTHETIC_RESTORE_VALIDATED` only. It is not a production restore.

## What is durable

| Data | Where it lives | Covered by a `/data` volume snapshot |
| --- | --- | --- |
| SQLite database | `DATA_DIR/app.db` (`/data/app.db` in production) | Yes, together with its `-wal` and `-shm` files |
| Local uploads | `DATA_DIR/uploads` | Yes, when `BLOB_READ_WRITE_TOKEN` is unset |
| Blob uploads | Vercel Blob, URL stored in the database | No |
| Withdrawal images | `process.cwd()/data/secure-uploads/withdrawals` | No. This path is not `getDataDir()` |
| Session signing and withdrawal decryption | `SESSION_SECRET`, or `WITHDRAWAL_ENCRYPTION_KEY` when set | No. These are Railway variables, not volume files |
| Web push private key | `WEB_PUSH_VAPID_*` env, or `app_meta.web_push_vapid_json` inside the database | Only the database copy |

Do not print or copy those variable values into tickets, logs, or GitHub artifacts.

Restoring only `app.db` drops local images whose database rows point at `/uploads/...`. Restoring the volume without the same encryption variables leaves encrypted withdrawal fields unreadable. Withdrawal images are outside the volume even when the database rows still point at them.

## Backup owner

Railway volume backups are the backup owner. This repository has no backup workflow and no in-process backup scheduler. Do not add one while the volume backup can be enabled.

Public Railway retention, from the volume backup documentation as of this audit:

- Daily: every 24 hours, kept 6 days
- Weekly: every 7 days, kept 27 days
- Monthly: every 30 days, kept 89 days

Billing is incremental and copy-on-write, at the same per-GB per-minute volume rate, invoiced monthly. A manual backup is limited to 50% of the volume size. Wiping a volume deletes its backups. A backup can be restored only into the same Railway project and environment.

Confirm the live schedule before relying on it: Railway → project → production → service `chat-ai` → volume mounted at `/data` → **Backups**. Record whether Daily, Weekly, and Monthly are on, the newest successful backup time, and that the mount is `/data`. If the API token cannot read `volumeInstanceBackupScheduleList` and `volumeInstanceBackupList`, leave the status `BACKUP_STATUS_UNVERIFIED`.

Enabling a schedule is a service change and can add backup storage cost. Do not enable it from a script. An operator turns it on in that Backups tab after accepting the cost.

## Incident first response

1. Stop. Do not delete the volume, detach it, or click Restore yet.
2. Name the incident: bad deploy, accidental row change, unreadable database, or missing uploads.
3. In Railway, copy the service id, volume id, current deployment id, and the backup id you might use. Do not download the database into GitHub.
4. Keep the current volume. Restore unmounts it and leaves it in the project under its original name. Deploy does not delete it. Backups newer than the restored point stay on that previous volume.
5. Decide whether writes must stop. A logical mistake that is still being written needs a maintenance pause before the snapshot you want is no longer the latest good one. A read-only investigation does not need a pause.
6. If you cannot point to one successful backup of `/data`, stop. There is no verified restore source.

## Choose a backup

Use the newest backup from before the bad write, not merely the newest backup. Match it to the incident time. If schedules were off, there may be no backup. Do not invent one from a redeploy or from `/health`.

## Railway staged restore

Do this only for the production project and its production environment. Railway rejects a restore into a different project or environment.

1. Tell a second operator which backup id and incident you are restoring.
2. Backups → select that backup → **Restore**. Railway stages a new volume named with the backup timestamp and mounts it at the original path (`/data`). The previous volume stays in the project, unmounted. Newer backups are not copied onto the restored volume; they remain on the previous volume.
3. Read the staged change. Do not click **Deploy** until the mount path is still `/data` and the service is still `chat-ai`.
4. Deploy the staged change. The service restarts on the restored volume.
5. If the staged result is wrong, stop and deploy again only to return to the retained previous volume. Do not wipe either volume.

## After the service is up

1. `GET https://hav.chat/health` returns `{"status":"ok"}`.
2. `GET https://hav.chat/api/health` returns `ok: true` and a `gitCommit`. That commit is the running build, not the backup time.
3. On a one-off Railway shell, open `/data/app.db` read-only and run `PRAGMA integrity_check` and `PRAGMA foreign_key_check`. Do not print user rows.
4. Confirm `/data/app.db-wal` is present or that SQLite has checkpointed it. Do not copy `app.db` by itself while WAL mode is on.
5. Open one public character image. If the URL is `/uploads/...`, the file must exist under `/data/uploads`. If the URL is a Blob host, the volume restore did not move those bytes.
6. Do not open withdrawal documents in the ticket. If a payout file is required, check only that the path key in the database still resolves, and expect `cwd/data/secure-uploads` to be missing on a fresh container.

## Stop conditions

- No backup id.
- The backup is for a different project or environment.
- The staged mount path is not `/data`.
- `integrity_check` is not `ok`.
- Restoring would require exporting the production database or its keys.
- The only missing files are Blob objects or `secure-uploads` and the volume snapshot cannot contain them.

## Synthetic proof

`src/lib/sqliteBackupRestore.synthetic.test.ts` creates a temporary database, writes fixture rows, and snapshots it with `VACUUM INTO`. The installed driver is libsql under the `better-sqlite3` name, and `Database.backup()` throws `not implemented`, so the fixture uses the SQL snapshot instead of copying a live `-wal` file. It then changes the original, restores into a separate file, and checks `integrity_check` and `foreign_key_check`. A damaged backup must fail before the destination bytes change. That test never opens the production volume.
