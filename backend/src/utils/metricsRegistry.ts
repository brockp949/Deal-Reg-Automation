type GaugeGetter = () => number | string | Record<string, any>;

class MetricsRegistry {
  private gauges: Record<string, GaugeGetter> = {};

  registerGauge(name: string, getter: GaugeGetter) {
    this.gauges[name] = getter;
  }

  snapshot() {
    const result: Record<string, any> = {};
    Object.entries(this.gauges).forEach(([name, getter]) => {
      try {
        result[name] = getter();
      } catch (err: any) {
        result[name] = { error: err.message };
      }
    });
    return result;
  }
}

export const metricsRegistry = new MetricsRegistry();
