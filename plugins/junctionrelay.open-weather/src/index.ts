import { getDecimalPlaces } from '@junctionrelay/collector-sdk';
import type { CollectorPluginConfig, SensorResult, ConfigureParams } from '@junctionrelay/collector-sdk';

const API_BASE = 'https://api.openweathermap.org/data/2.5/weather';

interface OpenWeatherResponse {
  weather: { id: number; main: string; description: string }[];
  main: {
    temp: number;
    feels_like: number;
    temp_min: number;
    temp_max: number;
    pressure: number;
    humidity: number;
  };
  visibility: number;
  wind: { speed: number; deg: number; gust?: number };
  clouds: { all: number };
  sys: { sunrise: number; sunset: number; country: string };
  name: string;
}

function extractConfig(config: ConfigureParams): { city: string; apiKey: string } {
  const city = (config.url ?? '').trim();
  const apiKey = (config.accessToken ?? '').trim();
  return { city, apiKey };
}

function windDirection(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

export default {
  metadata: {
    collectorName: 'junctionrelay.open-weather',
    displayName: 'OpenWeather',
    description: 'Current weather data from OpenWeather API',
    category: 'Cloud Services',
    emoji: '⛅',
    fields: {
      requiresUrl: true,
      requiresAccessToken: true,
      urlLabel: 'City',
      urlPlaceholder: 'London,UK',
      accessTokenLabel: 'OpenWeather API Key',
      accessTokenPlaceholder: 'your_api_key_here',
    },
    defaults: {
      name: 'OpenWeather',
      url: 'London,UK',
      pollRate: 300000,
      sendRate: 5000,
    },
    setupInstructions: [
      {
        title: 'Get a free API key',
        body: 'Sign up at https://openweathermap.org/api and create a free API key. The free tier allows 1,000 calls/day.',
      },
      {
        title: 'Enter your city',
        body: 'Use city name (e.g. "London"), city + country code (e.g. "London,UK"), or city + state + country (e.g. "Portland,OR,US").',
      },
    ],
  },

  async testConnection(config: ConfigureParams) {
    const { city, apiKey } = extractConfig(config);
    if (!city) return { success: false, error: 'City is required' };
    if (!apiKey) return { success: false, error: 'API key is required' };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const resp = await fetch(
        `${API_BASE}?q=${encodeURIComponent(city)}&appid=${encodeURIComponent(apiKey)}&units=metric`,
        { signal: controller.signal },
      );
      clearTimeout(timeout);

      if (resp.status === 401) return { success: false, error: 'Invalid API key' };
      if (resp.status === 404) return { success: false, error: 'City not found' };
      if (!resp.ok) return { success: false, error: `HTTP ${resp.status}: ${resp.statusText}` };

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async fetchSensors(config: ConfigureParams) {
    const { city, apiKey } = extractConfig(config);
    if (!city || !apiKey) throw new Error('Not configured — city and API key are required');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(
      `${API_BASE}?q=${encodeURIComponent(city)}&appid=${encodeURIComponent(apiKey)}&units=metric`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

    const data = await resp.json() as OpenWeatherResponse;
    const description = data.weather?.[0]?.description ?? 'Unknown';
    const condition = data.weather?.[0]?.main ?? 'Unknown';

    const sensors: SensorResult[] = [
      {
        uniqueSensorKey: 'weather_condition',
        name: 'Condition',
        value: condition,
        unit: 'N/A',
        category: 'Weather',
        decimalPlaces: 0,
        sensorType: 'Text',
        componentName: 'Weather',
        sensorTag: 'Condition',
      },
      {
        uniqueSensorKey: 'weather_description',
        name: 'Description',
        value: description,
        unit: 'N/A',
        category: 'Weather',
        decimalPlaces: 0,
        sensorType: 'Text',
        componentName: 'Weather',
        sensorTag: 'Description',
      },
      {
        uniqueSensorKey: 'weather_temperature',
        name: 'Temperature',
        value: data.main.temp.toFixed(1),
        unit: '\u00b0C',
        category: 'Temperature',
        decimalPlaces: getDecimalPlaces(data.main.temp.toFixed(1)),
        sensorType: 'Numeric',
        componentName: 'Temperature',
        sensorTag: 'Temperature',
      },
      {
        uniqueSensorKey: 'weather_feels_like',
        name: 'Feels Like',
        value: data.main.feels_like.toFixed(1),
        unit: '\u00b0C',
        category: 'Temperature',
        decimalPlaces: getDecimalPlaces(data.main.feels_like.toFixed(1)),
        sensorType: 'Numeric',
        componentName: 'Temperature',
        sensorTag: 'FeelsLike',
      },
      {
        uniqueSensorKey: 'weather_temp_min',
        name: 'Temperature Min',
        value: data.main.temp_min.toFixed(1),
        unit: '\u00b0C',
        category: 'Temperature',
        decimalPlaces: getDecimalPlaces(data.main.temp_min.toFixed(1)),
        sensorType: 'Numeric',
        componentName: 'Temperature',
        sensorTag: 'TemperatureMin',
      },
      {
        uniqueSensorKey: 'weather_temp_max',
        name: 'Temperature Max',
        value: data.main.temp_max.toFixed(1),
        unit: '\u00b0C',
        category: 'Temperature',
        decimalPlaces: getDecimalPlaces(data.main.temp_max.toFixed(1)),
        sensorType: 'Numeric',
        componentName: 'Temperature',
        sensorTag: 'TemperatureMax',
      },
      {
        uniqueSensorKey: 'weather_humidity',
        name: 'Humidity',
        value: String(data.main.humidity),
        unit: '%',
        category: 'Atmosphere',
        decimalPlaces: 0,
        sensorType: 'Numeric',
        componentName: 'Atmosphere',
        sensorTag: 'Humidity',
      },
      {
        uniqueSensorKey: 'weather_pressure',
        name: 'Pressure',
        value: String(data.main.pressure),
        unit: 'hPa',
        category: 'Atmosphere',
        decimalPlaces: 0,
        sensorType: 'Numeric',
        componentName: 'Atmosphere',
        sensorTag: 'Pressure',
      },
      {
        uniqueSensorKey: 'weather_visibility',
        name: 'Visibility',
        value: (data.visibility / 1000).toFixed(1),
        unit: 'km',
        category: 'Atmosphere',
        decimalPlaces: getDecimalPlaces((data.visibility / 1000).toFixed(1)),
        sensorType: 'Numeric',
        componentName: 'Atmosphere',
        sensorTag: 'Visibility',
      },
      {
        uniqueSensorKey: 'weather_wind_speed',
        name: 'Wind Speed',
        value: data.wind.speed.toFixed(1),
        unit: 'm/s',
        category: 'Wind',
        decimalPlaces: getDecimalPlaces(data.wind.speed.toFixed(1)),
        sensorType: 'Numeric',
        componentName: 'Wind',
        sensorTag: 'WindSpeed',
      },
      {
        uniqueSensorKey: 'weather_wind_direction',
        name: 'Wind Direction',
        value: windDirection(data.wind.deg),
        unit: '\u00b0',
        category: 'Wind',
        decimalPlaces: 0,
        sensorType: 'Text',
        componentName: 'Wind',
        sensorTag: 'WindDirection',
      },
      {
        uniqueSensorKey: 'weather_wind_deg',
        name: 'Wind Degrees',
        value: String(data.wind.deg),
        unit: '\u00b0',
        category: 'Wind',
        decimalPlaces: 0,
        sensorType: 'Numeric',
        componentName: 'Wind',
        sensorTag: 'WindDegrees',
      },
      {
        uniqueSensorKey: 'weather_clouds',
        name: 'Cloud Coverage',
        value: String(data.clouds.all),
        unit: '%',
        category: 'Weather',
        decimalPlaces: 0,
        sensorType: 'Numeric',
        componentName: 'Weather',
        sensorTag: 'Clouds',
      },
      {
        uniqueSensorKey: 'weather_sunrise',
        name: 'Sunrise',
        value: new Date(data.sys.sunrise * 1000).toLocaleTimeString(),
        unit: 'time',
        category: 'Sun',
        decimalPlaces: 0,
        sensorType: 'Text',
        componentName: 'Sun',
        sensorTag: 'Sunrise',
      },
      {
        uniqueSensorKey: 'weather_sunset',
        name: 'Sunset',
        value: new Date(data.sys.sunset * 1000).toLocaleTimeString(),
        unit: 'time',
        category: 'Sun',
        decimalPlaces: 0,
        sensorType: 'Text',
        componentName: 'Sun',
        sensorTag: 'Sunset',
      },
      {
        uniqueSensorKey: 'weather_location',
        name: 'Location',
        value: `${data.name}, ${data.sys.country}`,
        unit: 'N/A',
        category: 'Location',
        decimalPlaces: 0,
        sensorType: 'Text',
        componentName: 'Location',
        sensorTag: 'Location',
      },
    ];

    // Include wind gust if available
    if (data.wind.gust !== undefined) {
      sensors.push({
        uniqueSensorKey: 'weather_wind_gust',
        name: 'Wind Gust',
        value: data.wind.gust.toFixed(1),
        unit: 'm/s',
        category: 'Wind',
        decimalPlaces: getDecimalPlaces(data.wind.gust.toFixed(1)),
        sensorType: 'Numeric',
        componentName: 'Wind',
        sensorTag: 'WindGust',
      });
    }

    return { sensors };
  },
} satisfies CollectorPluginConfig;
