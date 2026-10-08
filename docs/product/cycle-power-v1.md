# Askesis cycle-power-v1

Cycling zones are percentages of functional threshold power (FTP), following Andrew Coggan's power levels with a sweet-spot band added between tempo and threshold. The factors below are common field-test conventions, not laboratory measurements.

## FTP from an input

| Method               | Input                      | FTP                |
| -------------------- | -------------------------- | ------------------ |
| `ftp`                | A known FTP in watts       | as entered         |
| `twenty_minute_test` | Average power for 20 min   | average × 0.95     |
| `ramp_test`          | Best one-minute ramp power | best minute × 0.75 |

FTP is rounded to the nearest watt and must be 50–600 W; inputs outside that range fail visibly. The ramp factor tends to overestimate riders with a strong anaerobic capacity; a 20-minute test is the better-validated protocol. Testing indoors usually reads lower than outdoors. No weight, age or critical-power modelling is applied.

## Zones

| Zone         | Minimum | Target | Maximum |
| ------------ | ------- | ------ | ------- |
| `recovery`   | 40%     | 50%    | 55%     |
| `endurance`  | 56%     | 65%    | 75%     |
| `tempo`      | 76%     | 83%    | 90%     |
| `sweet_spot` | 88%     | 91%    | 94%     |
| `threshold`  | 91%     | 100%   | 105%    |
| `vo2max`     | 106%    | 113%   | 120%    |
| `anaerobic`  | 121%    | 135%   | 150%    |

Each bound is rounded to whole watts. Sprints above 150% have no upper bound and are prescribed as all-out efforts with RPE rather than as a zone. Coaching adds an RPE target to key efforts so riders without a power meter can follow the session.

Stored entries keep their input, calculator version and every zone; the internal fitness value is the FTP. Changing this specification requires a new calculator version.

Sources: [Pain Cave, ramp vs 20-minute vs critical power](https://www.paincave.io/blog/ftp-ramp-vs-20min); [Roadman Cycling, FTP test protocols compared](https://roadmancycling.com/blog/ftp-test-protocols-compared-cycling).
