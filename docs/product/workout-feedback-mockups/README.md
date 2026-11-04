# Workout logging and feedback mockups

Static design mockups for the [workout logging and feedback proposal](../workout-log-and-feedback-proposal.md). They are not part of the app build.

Each page links the web app's real stylesheet (`apps/web/src/styles`) through `mockups.css`, which adds only the proposed components. `icons.js` is generated from the `lucide-react` package the web app uses. `shell.js` wraps pages in the app's sidebar and tab-bar markup.

| Page                                                     | Screenshot                               | Width |
| -------------------------------------------------------- | ---------------------------------------- | ----- |
| [today.html](./today.html)                               | `screens/today-desktop.png`              | 1280  |
| [today-quick-log.html](./today-quick-log.html)           | `screens/today-quick-log-phone.png`      | 390   |
| [feedback-key-session.html](./feedback-key-session.html) | `screens/feedback-key-session-phone.png` | 390   |
| [plan-week.html](./plan-week.html)                       | `screens/plan-week-desktop.png`          | 1280  |
| [logged-workout.html](./logged-workout.html)             | `screens/logged-workout-desktop.png`     | 1280  |
| [coach-chat.html](./coach-chat.html)                     | `screens/coach-chat-desktop.png`         | 1440  |
| [not-feeling-100.html](./not-feeling-100.html)           | `screens/not-feeling-100-phone.png`      | 390   |

Open a page from a local checkout in a browser, or re-render a screenshot from the repository root:

```bash
chromium --headless=new --hide-scrollbars --allow-file-access-from-files \
  --window-size=390,1760 --force-device-scale-factor=2 \
  --screenshot=docs/product/workout-feedback-mockups/screens/feedback-key-session-phone.png \
  "file://$PWD/docs/product/workout-feedback-mockups/feedback-key-session.html"
```
