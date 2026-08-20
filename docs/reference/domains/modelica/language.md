# Reference: Modelica language

Audience: both · Diátaxis: reference · Kind: contract

`modelica-closed-subset-v2` / `2.0.0` is a bounded executable language, not general
Modelica or Modelica Standard Library support. The capture frontend and worker use the
same authorizer; a source that the worker refuses cannot become admitted through
capture.

## Accepted form

One canonical UTF-8 source (1 to 262,144 bytes, no NUL) has exactly this shape:

```text
model <ModelName> ["description"]
  parameter Real <parameter>(unit = "<unit>") = <finite-number>;
  output Real <output>(unit = "<unit>", start = <finite-number|parameter>, fixed = true);
equation
  der(<output>) = <expression>; | <output> = <expression>;
annotation(experiment(StartTime = <number>, StopTime = <number>, Interval = <number>, Tolerance = <number>));
end <ModelName>;
```

- There are 1–32 uniquely named `parameter Real` declarations and 1–16 uniquely named
  `output Real` declarations; their names cannot collide.
- Declarations carry exactly the attributes shown. A `start` reference must name a
  declared parameter. Units are non-empty bounded ASCII unit strings.
- There is exactly one equation per output, every equation left-hand side is a declared
  output, and at least one is a derivative equation. The right-hand side contains only
  finite scalar literals, declared names, parentheses, and `+`, `-`, `*`, `/`.
- The `experiment` annotation is mandatory and has exactly `StartTime`, `StopTime`,
  `Interval`, and `Tolerance`. Its duration is `> 0` and `<= 120 s`; its interval gives
  an exact grid of 10–2,000 intervals; tolerance is in `[1e-12, 0.1]`.

Whitespace, line/block comments, and the optional description string are accepted. No
other syntax is authority: imports, `extends`, packages, components, `connect`, arrays,
functions, algorithms, events, external code, extra sections, or a second root model
are refused.

The source annotation declares the simulation scenario. It does not authorize a run;
admission and a separate human MRTR remain required.
