# Activity connections (Strava)

How to run the Strava connection locally, with your own Strava account or with the bundled simulator. The design and Strava's terms are in the [activity integration proposal](../product/activity-integration-proposal.md).

The API enables Strava only when `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` and `INTEGRATION_ENCRYPTION_KEY` are all set. Otherwise Settings shows "Not configured on this server". The coaching worker never receives activity data or these variables.

## Your own Strava account

A Strava subscription is required to create an API application. A new application is in single-player mode: only the Strava account that owns it can connect.

1. Create an application at <https://www.strava.com/settings/api>. Set **Authorization Callback Domain** to `localhost`. Copy its Client ID and Client Secret.
2. Add them to the ignored `.env` of the checkout you run, with an encryption key for stored tokens. Remove any simulator `STRAVA_*_BASE_URL` overrides:

   ```bash
   STRAVA_CLIENT_ID=<client id>
   STRAVA_CLIENT_SECRET=<client secret>
   INTEGRATION_ENCRYPTION_KEY=<output of: openssl rand -base64 32>
   ```

3. Restart the API (`pnpm dev:local`, or restart the worktree's background service). Check `/api/ready`.
4. Sign in to the web app, open **You › Connections**, choose **Connect with Strava** and authorize. Strava returns to `/connections/strava/callback`, which finishes connecting and imports activities from a week before your earliest active plan.
5. Open **Today**, **Plan** or any past workout. "What you did" shows the matched activity, rep checks when laps exist, and controls to reject or link a different activity.

Activities match against the active plans of the Askesis account you connect from. To see real matches, use a plan whose dates cover your recent training (the seeded examples start on the previous Monday). The redirect origin must be one of `CLERK_AUTHORIZED_PARTIES`, or localhost when that is unset.

Keep the client secret and encryption key out of commits, screenshots and chat. Changing `INTEGRATION_ENCRYPTION_KEY` makes stored tokens unreadable; disconnect and reconnect afterwards.

## Local simulator

The simulator imitates Strava's OAuth and activity endpoints. It invents a history for one locked plan in your local database: most sessions done with interval laps, one a day late, one cut short, one missed, a rep ridden too easy, a walk and an extra run. It refuses to run in production.

```bash
pnpm strava:simulate --port 4010                 # the active plan with the most sports
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

Restart the API, then connect from Settings. The simulated consent page has Authorize and Cancel. The simulated history is fixed when the simulator starts; restart it after changing plans. Production rejects non-HTTPS Strava URLs.

## Operating notes

- **Seven-day cache.** Strava's API policy limits stored data to a seven-day cache. Every sync refreshes the plan window. The API purges activities and laps not refreshed for seven days, every hour. The athlete's link/reject decisions are kept until they disconnect.
- **Sync.** "Sync now" in Settings, and an automatic sync when the app opens more than 30 minutes after the last one. One sync per connection runs at a time (a two-minute lease).
- **Rate limits.** Strava allows 100 reads per 15 minutes and 1,000 per day per application. Laps are fetched for at most 30 activities per sync, and a sync stops at 80% of the 15-minute budget. The next sync continues.
- **Errors.** A revoked or expired grant marks the connection `reauthorization_required`, and Settings offers Reconnect. Rate limits and outages are recorded as the last sync error without changing data.
- **Disconnect.** Revokes the grant at Strava (`oauth/revoke`) and deletes the connection, activities, laps and decisions immediately.
- **Inspect.** `integration_connections`, `activities`, `activity_laps` and `activity_match_overrides`. Tokens are stored encrypted; never decrypt them in a shared session.
