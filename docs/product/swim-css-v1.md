# Askesis swim-css-v1

Swim zones derive from critical swim speed (CSS), the sustainable threshold speed popularised by Swim Smooth.

## CSS from an input

| Method     | Input                                         | CSS pace per 100 m |
| ---------- | --------------------------------------------- | ------------------ |
| `css_test` | All-out 400 and 200 times, with full recovery | (T400 − T200) / 2  |
| `css_pace` | A known CSS pace in seconds per 100 metres    | as entered         |

CSS speed is 200 m / (T400 − T200). A test is rejected unless the 400 is slower per 100 than the 200 (T400 > 2 × T200); otherwise the 200 was not swum all-out. CSS pace must be 0:55–5:00 per 100 m. The web converts yard-pool times to metres (one yard is 0.9144 m) before submission, so the API always receives metric times.

## Zones

Bands are fractions of CSS **speed**, converted to pace as CSS pace ÷ fraction. Calculator sites disagree about whether published percentages apply to speed or pace; this specification uses speed.

| Zone        | Slowest | Target | Fastest |
| ----------- | ------- | ------ | ------- |
| `recovery`  | 77%     | 82%    | 87%     |
| `endurance` | 87%     | 90%    | 94%     |
| `tempo`     | 95%     | 96.5%  | 98%     |
| `threshold` | 99%     | 100%   | 104%    |
| `speed`     | 105%    | 108%   | 112%    |

Zones are stored as seconds per 100 metres to three decimal places; for pace the minimum is the faster bound. Display rounds to the second, per 100 m or per 100 yd. Send-off intervals (for example "on 1:55") are written in step instructions. Changing this specification requires a new calculator version.

Sources: [TrainingZones, critical swim speed guide](https://www.trainingzones.io/en/guides/critical-swim-speed); [HP3 CSS calculator](https://www.hp-3.co.uk/training-calculators/swimcsscalculator); [Topend Sports, CSS test](https://www.topendsports.com/testing/tests/critical-swim-speed.htm).
