model HeatedStagePlate
  parameter Real initialTemperature(unit = "K") = 298.15;
  parameter Real electricalPower(unit = "W") = 5;
  parameter Real thermalConductance(unit = "W/K") = 0.5;
  parameter Real thermalCapacity(unit = "J/K") = 50;
  output Real temperature(unit = "K", start = initialTemperature, fixed = true);
equation
  der(temperature) = (electricalPower - thermalConductance * (temperature - initialTemperature)) / thermalCapacity;
annotation(experiment(StartTime = 0, StopTime = 120, Interval = 1, Tolerance = 0.000001));
end HeatedStagePlate;
