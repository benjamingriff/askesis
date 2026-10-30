# Strava activity links

How to run the Strava connection locally, with your own Strava account or the bundled simulator. The design and its constraints are in [ADR 0008](../adr/0008-manual-strava-links.md).

## What it does

- **Settings › Connections:** connect, reconnect or disconnect Strava.
- **Find my activity** (Strava orange) on Today's log bar, in the workout dialog and in the log sheet. It lists your Strava activities from the week either side of the workout. Choose one to link it. Linking is always manual.
- **View on Strava** appears wherever a workout has a link.
- **Show details** in the log sheet opens a panel beside the form (above it on a phone). It shows the activity's numbers, laps and heart rate, read from Strava when the panel opens. You fill in the form yourself; nothing is copied into it.
- **Change** or **Unlink** replaces or removes the link.

Askesis stores only the link: which Strava activity id belongs to which workout. The coach never sees links or Strava data.

The API enables Strava only when `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` and `INTEGRATION_ENCRYPTION_KEY` are all set. Otherwise Settings says "Not configured on this server".

## Your own Strava account

A Strava subscription is required to create an API application. New applications are single-player: only the Strava account that owns the app can connect.

1. Create an application at <https://www.strava.com/settings/api>. Set **Authorization Callback Domain** to `localhost`, and copy the Client ID and Client Secret.
2. In the ignored `.env` of the checkout you run, set these and **remove** any `STRAVA_OAUTH_BASE_URL` / `STRAVA_API_BASE_URL` simulator overrides:

   ```bash
   STRAVA_CLIENT_ID=<client id>
   STRAVA_CLIENT_SECRET=<client secret>
   INTEGRATION_ENCRYPTION_KEY=<output of: openssl rand -base64 32>
   ```

3. Restart the API and check `/api/ready`.
4. Sign in, open **Settings › Connections**, choose **Connect with Strava** and authorize. Keep "View data about your activities" ticked.
5. Open a past workout on Today or the Plan. Choose **Find my activity**, pick the activity, then **Add details** or **Edit** to open the log sheet with the panel.

The redirect origin must be one of `CLERK_AUTHORIZED_PARTIES`, or localhost when that is unset. Keep the client secret and encryption key out of commits, screenshots and chat. Changing `INTEGRATION_ENCRYPTION_KEY` makes stored tokens unreadable; disconnect and reconnect afterwards.

## Local simulator

The simulator imitates Strava's OAuth, activity list and activity detail endpoints. It invents a recent history from one locked plan in the local database: most past sessions on their day, some a day late, some missing, plus a walk and an extra run. It refuses to run in production.

```bash
pnpm strava:simulate --port 4010                 # the most recently activated locked plan
pnpm strava:simulate --port 4010 --plan <plan id>
```

Point the API at it in `.env` (any client id and secret work):

```bash
STRAVA_CLIENT_ID=12345
STRAVA_CLIENT_SECRET=simulated-secret
INTEGRATION_ENCRYPTION_KEY=<output of: openssl rand -base64 32>
STRAVA_OAUTH_BASE_URL=http://localhost:4010
STRAVA_API_BASE_URL=http://localhost:4010/api/v3
```

Restart the API, then connect from Settings. The consent page offers Authorize and Cancel. The history is fixed when the simulator starts. Production rejects non-HTTPS Strava URLs.

## Operating notes

- **Rate limits.** Strava allows 100 reads per 15 minutes and 1,000 per day per application. Opening the picker or the details panel costs one read. The browser reuses a response for five minutes.
- **Errors.** A revoked or expired grant marks the connection `reauthorization_required`. Settings then offers Reconnect, and lookups hide until then. Existing links keep their View on Strava button. An activity deleted on Strava shows "Strava couldn't find that activity"; unlink it.
- **Disconnect.** Revokes the grant at Strava (`oauth/revoke`) and deletes the connection and every link immediately.
- **Deletion and export.** Deleted plans hide their links during the restore window; restoring brings the links back, and final plan purge removes them. Account purge deletes every connection and link. Account exports include connection metadata and activity links, excluding access and refresh credentials.
- **Inspect.** `integration_connections` and `workout_activity_links`. Tokens are encrypted; never decrypt them in a shared session.
