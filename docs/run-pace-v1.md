# Askesis run-pace-v1

This calculator uses the Daniels-Gilbert race-performance regressions from [Oxygen Power, 1979](https://www.vivamarathon.com/oxygenpower.pdf). Training targets and tolerance bands below are an explicit Askesis approximation, not a reproduction of proprietary V.O2 training tables.

For velocity `v` in metres/minute and race duration `t` in minutes:

```text
oxygen(v) = -4.60 + 0.182258v + 0.000104v²
fraction(t) = 0.8 + 0.1894393 exp(-0.012778t) + 0.2989558 exp(-0.1932605t)
fitness = oxygen(distance / t) / fraction(t)
```

Threshold input is treated as estimated one-hour race effort: `fitness = oxygen(60000 / paceSecondsPerKm) / fraction(60)`. The internal scalar is not displayed.

| Guide      | Target                                                                                  | Speed tolerance |
| ---------- | --------------------------------------------------------------------------------------- | --------------- |
| Easy       | 67% of the internal oxygen-cost scalar                                                  | ±6%             |
| Marathon   | Equivalent 42,195 m race speed, solved by 80 bisection iterations over 60–1,500 minutes | ±2%             |
| Threshold  | One-hour effort using `fraction(60)`                                                    | ±1.5%           |
| Interval   | 100% of the internal scalar                                                             | ±1%             |
| Repetition | 110% of the internal scalar                                                             | ±0.75%          |

For target pace `p` and tolerance `w`, faster bound is `p/(1+w)` and slower bound is `p/(1-w)`. These bands are product guides, not statistical confidence intervals. Seconds-per-kilometre values are persisted to three decimal places. Display rounds to the nearest second after converting into the plan unit; display values are never fed back into saved quantities unless the user edits the input.

Race distances are 1,609.344–42,195 metres inclusive, with integer positive finish seconds. The internal scalar must be finite and between 10 and 100; inputs beyond this numerical domain fail visibly rather than producing nonsensical zones. No weather, age, race-date, or terrain adjustment is applied.

Stored profiles retain their inputs, calculator version, and all five outputs. Changing this specification requires a new calculator version. Historical reads and “use again” preserve stored outputs.
