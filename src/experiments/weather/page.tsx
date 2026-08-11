import { useState, useEffect } from 'react';
import { Cloud, CloudRain, Sun, CloudSnow, Wind, MapPin, Moon } from 'lucide-react';
import styles from './weather.module.css';
import type { ExperimentPageProps } from '../../platform/manifest.js';

const ALERT_SEVERITY_STYLES: Record<string, string> = {
  extreme: styles.alertExtreme,
  severe: styles.alertSevere,
  moderate: styles.alertModerate,
  minor: styles.alertMinor,
  unknown: styles.alertUnknown,
};

const WEATHER_CODES: Record<number, string> = {
  0: 'Clear',
  1: 'Mainly Clear',
  2: 'Partly Cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Foggy',
  51: 'Light Drizzle',
  53: 'Drizzle',
  55: 'Heavy Drizzle',
  61: 'Light Rain',
  63: 'Rain',
  65: 'Heavy Rain',
  71: 'Light Snow',
  73: 'Snow',
  75: 'Heavy Snow',
  80: 'Rain Showers',
  81: 'Rain Showers',
  82: 'Heavy Rain Showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with Hail',
  99: 'Thunderstorm with Hail',
};

interface ForecastData {
  temperatures: number[];
  temperaturesMins: number[];
  conditions: string[];
  dewPoints: number[];
  dates: string[];
}

interface WeatherData {
  location: string;
  temperature: number;
  conditions: string;
  dewPoint: number;
  dewPointLabel: string;
  timezone: string;
  currentTime: string;
  isNight: boolean;
  forecast: ForecastData;
}

export default function WeatherPage(_props: ExperimentPageProps) {
  const [location, setLocation] = useState(
    () => new URLSearchParams(window.location.search).get('loc') || ''
  );
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [gettingLocation, setGettingLocation] = useState(false);
  const [unit, setUnit] = useState('F'); // 'F' or 'C'
  const [alerts, setAlerts] = useState<any[]>([]);

  const convertTemp = (tempF: number) => {
    if (unit === 'C') {
      return Math.round((tempF - 32) * 5/9);
    }
    return Math.round(tempF);
  };

  const getDewPointLabel = (dewPoint: number) => {
    if (dewPoint < 40) return 'crispy';
    if (dewPoint < 50) return 'dry';
    if (dewPoint < 60) return 'comfy';
    if (dewPoint < 70) return 'dank';
    return 'oppressive';
  };

  const getWeatherIcon = (conditions: string, isNight = false) => {
    const lower = conditions.toLowerCase();
    if (lower.includes('rain') || lower.includes('drizzle')) {
      return <CloudRain className={`${styles.icon} ${styles.iconRain}`} />;
    }
    if (lower.includes('snow')) {
      return <CloudSnow className={`${styles.icon} ${styles.iconSnow}`} />;
    }
    if (lower.includes('cloud') || lower.includes('overcast')) {
      return <Cloud className={`${styles.icon} ${styles.iconCloud}`} />;
    }
    if (lower.includes('wind')) {
      return <Wind className={`${styles.icon} ${styles.iconWind}`} />;
    }
    return isNight
      ? <Moon className={`${styles.icon} ${styles.iconNight}`} />
      : <Sun className={`${styles.icon} ${styles.iconSun}`} />;
  };

  const fetchAlerts = async (lat: number, lon: number) => {
    try {
      const response = await fetch(
        `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`,
        { headers: { Accept: 'application/geo+json' } }
      );
      if (!response.ok) {
        // NWS only covers the US; non-US points return an error
        setAlerts([]);
        return;
      }
      const data = await response.json();
      setAlerts(data.features || []);
    } catch {
      setAlerts([]);
    }
  };

  const fetchWeatherByCoords = async (lat: number, lon: number) => {
    console.log('📍 Fetching weather for coordinates:', { lat, lon });
    setLoading(true);
    setError('');
    setAlerts([]);

    try {
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset&temperature_unit=fahrenheit&timezone=auto&forecast_days=7`;
      console.log('🌤️ Fetching weather from:', weatherUrl);

      const weatherResponse = await fetch(weatherUrl);
      console.log('📥 Weather response status:', weatherResponse.status);

      const weatherData = await weatherResponse.json();
      console.log('✅ Weather data received:', weatherData);

      // Reverse geocode to get location name
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?latitude=${lat}&longitude=${lon}&count=1&language=en&format=json`;
      console.log('🗺️ Reverse geocoding:', geoUrl);

      const geoResponse = await fetch(geoUrl);
      console.log('📥 Geocoding response status:', geoResponse.status);

      const geoData = await geoResponse.json();
      console.log('✅ Geocoding data received:', geoData);

      const locationName = geoData.results && geoData.results.length > 0
        ? `${geoData.results[0].name}, ${geoData.results[0].admin1 || geoData.results[0].country}`
        : `${lat.toFixed(2)}, ${lon.toFixed(2)}`;

      const tempF = weatherData.current.temperature_2m;
      const tempC = (tempF - 32) * 5/9;
      const rh = weatherData.current.relative_humidity_2m;
      const a = 17.27;
      const b = 237.7;
      const alpha = ((a * tempC) / (b + tempC)) + Math.log(rh / 100);
      const dewPointC = (b * alpha) / (a - alpha);
      const dewPoint = Math.round((dewPointC * 9/5) + 32);

      // Calculate dew point for each forecast day
      const forecastDewPoints = weatherData.daily.temperature_2m_max.map((maxTemp: number, i: number) => {
        const minTemp = weatherData.daily.temperature_2m_min[i];
        const avgTempF = (maxTemp + minTemp) / 2;
        const avgTempC = (avgTempF - 32) * 5/9;
        const estimatedRH = 70;
        const alpha = ((a * avgTempC) / (b + avgTempC)) + Math.log(estimatedRH / 100);
        const dewPointC = (b * alpha) / (a - alpha);
        return Math.round((dewPointC * 9/5) + 32);
      });

      const conditions = WEATHER_CODES[weatherData.current.weather_code] || 'Unknown';
      const forecastConditions = weatherData.daily.weather_code.map((code: number) =>
        WEATHER_CODES[code] || 'Unknown'
      );

      // Determine if it's night time
      const currentTime = new Date(weatherData.current.time);
      const sunrise = new Date(weatherData.daily.sunrise[0]);
      const sunset = new Date(weatherData.daily.sunset[0]);
      const isNight = currentTime < sunrise || currentTime > sunset;

      setWeather({
        location: locationName,
        temperature: Math.round(tempF),
        conditions,
        dewPoint,
        dewPointLabel: getDewPointLabel(dewPoint),
        timezone: weatherData.timezone,
        currentTime: weatherData.current.time,
        isNight,
        forecast: {
          temperatures: weatherData.daily.temperature_2m_max.slice(1, 8),
          temperaturesMins: weatherData.daily.temperature_2m_min.slice(1, 8),
          conditions: forecastConditions.slice(1, 8),
          dewPoints: forecastDewPoints.slice(1, 8),
          dates: weatherData.daily.time.slice(1, 8)
        }
      });
      window.history.replaceState({}, '', `/weather?loc=${encodeURIComponent(locationName)}`);
      console.log('✅ Weather state updated successfully');
      fetchAlerts(lat, lon);
    } catch (err) {
      const e = err as Error;
      console.error('❌ Error fetching weather by coords:', err);
      console.error('Error details:', { message: e.message, stack: e.stack });
      setError('Failed to fetch weather data');
    } finally {
      setLoading(false);
    }
  };

  const fetchWeather = async () => {
    if (!location.trim()) {
      setError('Please enter a location');
      return;
    }

    console.log('🔍 Searching for location:', location);
    setLoading(true);
    setError('');
    setAlerts([]);

    try {
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
      console.log('🗺️ Geocoding URL:', geoUrl);

      const geoResponse = await fetch(geoUrl);
      console.log('📥 Geocoding response status:', geoResponse.status);

      const geoData = await geoResponse.json();
      console.log('✅ Geocoding results:', geoData);

      if (!geoData.results || geoData.results.length === 0) {
        setError('Location not found');
        setLoading(false);
        return;
      }

      const { latitude, longitude, name, admin1, country } = geoData.results[0];

      const weatherResponse = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset&temperature_unit=fahrenheit&timezone=auto&forecast_days=7`
      );
      const weatherData = await weatherResponse.json();

      const tempF = weatherData.current.temperature_2m;
      const tempC = (tempF - 32) * 5/9;
      const rh = weatherData.current.relative_humidity_2m;
      const a = 17.27;
      const b = 237.7;
      const alpha = ((a * tempC) / (b + tempC)) + Math.log(rh / 100);
      const dewPointC = (b * alpha) / (a - alpha);
      const dewPoint = Math.round((dewPointC * 9/5) + 32);

      // Calculate dew point for each forecast day
      const forecastDewPoints = weatherData.daily.temperature_2m_max.map((maxTemp: number, i: number) => {
        const minTemp = weatherData.daily.temperature_2m_min[i];
        const avgTempF = (maxTemp + minTemp) / 2;
        const avgTempC = (avgTempF - 32) * 5/9;
        // Estimate RH at ~70% for dew point forecast (typical average)
        const estimatedRH = 70;
        const alpha = ((a * avgTempC) / (b + avgTempC)) + Math.log(estimatedRH / 100);
        const dewPointC = (b * alpha) / (a - alpha);
        return Math.round((dewPointC * 9/5) + 32);
      });

      const conditions = WEATHER_CODES[weatherData.current.weather_code] || 'Unknown';

      // Get forecast conditions
      const forecastConditions = weatherData.daily.weather_code.map((code: number) =>
        WEATHER_CODES[code] || 'Unknown'
      );

      // Determine if it's night time
      const currentTime = new Date(weatherData.current.time);
      const sunrise = new Date(weatherData.daily.sunrise[0]);
      const sunset = new Date(weatherData.daily.sunset[0]);
      const isNight = currentTime < sunrise || currentTime > sunset;

      setWeather({
        location: `${name}, ${admin1 || country}`,
        temperature: Math.round(tempF),
        conditions,
        dewPoint,
        dewPointLabel: getDewPointLabel(dewPoint),
        timezone: weatherData.timezone,
        currentTime: weatherData.current.time,
        isNight,
        forecast: {
          temperatures: weatherData.daily.temperature_2m_max.slice(1, 8), // Next 7 days
          temperaturesMins: weatherData.daily.temperature_2m_min.slice(1, 8),
          conditions: forecastConditions.slice(1, 8),
          dewPoints: forecastDewPoints.slice(1, 8),
          dates: weatherData.daily.time.slice(1, 8)
        }
      });
      const resolvedName = `${name}, ${admin1 || country}`;
      window.history.replaceState({}, '', `/weather?loc=${encodeURIComponent(resolvedName)}`);
      console.log('✅ Weather data processed successfully');
      fetchAlerts(latitude, longitude);
    } catch (err) {
      const e = err as Error;
      console.error('❌ Error in fetchWeather:', err);
      console.error('Error details:', { message: e.message, stack: e.stack });
      setError('Failed to fetch weather data');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      fetchWeather();
    }
  };

  const getUserLocation = () => {
    console.log('🌍 Attempting to get user location...');
    console.log('🔒 Page is secure context:', window.isSecureContext);
    console.log('🌐 Protocol:', window.location.protocol);
    console.log('🏠 Hostname:', window.location.hostname);

    if (!navigator.geolocation) {
      console.error('❌ Geolocation API not available');
      setError('Geolocation is not supported by your browser');
      return;
    }

    console.log('✅ Geolocation API is available');
    setGettingLocation(true);
    setError('');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        console.log('✅ Position acquired:', {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: new Date(position.timestamp)
        });
        setGettingLocation(false);
        fetchWeatherByCoords(position.coords.latitude, position.coords.longitude);
      },
      (error) => {
        console.error('❌ Geolocation error:', {
          code: error.code,
          message: error.message,
          PERMISSION_DENIED: error.PERMISSION_DENIED,
          POSITION_UNAVAILABLE: error.POSITION_UNAVAILABLE,
          TIMEOUT: error.TIMEOUT
        });
        setGettingLocation(false);
        let errorMessage;
        switch(error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = 'Location permission denied. Please enable location services.';
            console.error('🚫 User denied location permission');
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = 'Location information unavailable.';
            console.error('📍 Position unavailable');
            break;
          case error.TIMEOUT:
            errorMessage = 'Location request timed out.';
            console.error('⏱️ Location request timeout');
            break;
          default:
            errorMessage = 'An unknown error occurred while getting location.';
            console.error('❓ Unknown geolocation error');
        }
        setError(errorMessage);
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000
      }
    );
  };

  useEffect(() => {
    const locParam = new URLSearchParams(window.location.search).get('loc');
    if (locParam) {
      fetchWeather();
    } else {
      getUserLocation();
    }
  }, []);

  return (
    <div className={styles.app}>
      <div className={styles.card}>
        <h1 className={styles.title}>
          Weather Forecast
        </h1>

        <div className={styles.searchRow}>
          <div className={styles.searchInputs}>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Enter city name"
              className={styles.input}
            />
            <button
              onClick={getUserLocation}
              disabled={gettingLocation || loading}
              title="Use my location"
              className={styles.locationBtn}
            >
              <MapPin size={20} />
            </button>
            <button
              onClick={fetchWeather}
              disabled={loading}
              className={styles.searchBtn}
            >
              {loading ? 'Loading...' : 'Search'}
            </button>
          </div>
        </div>

        {error && (
          <div className={styles.error}>
            <p>{error}</p>
          </div>
        )}

        {alerts.length > 0 && (
          <div className={styles.alerts}>
            {alerts.map((alert, i) => {
              const p = alert.properties;
              const severity = (p.severity || 'unknown').toLowerCase();
              const severityClass = ALERT_SEVERITY_STYLES[severity] ?? styles.alertUnknown;
              return (
                <div key={i} className={`${styles.alert} ${severityClass}`}>
                  <div className={styles.alertHeader}>
                    <span className={styles.alertEvent}>{p.event}</span>
                    <span className={styles.alertBadge}>{p.severity}</span>
                  </div>
                  {p.headline && (
                    <div className={styles.alertHeadline}>{p.headline}</div>
                  )}
                  {(p.description || p.instruction) && (
                    <details className={styles.alertDetails}>
                      <summary>Details</summary>
                      {p.description && <p>{p.description}</p>}
                      {p.instruction && (
                        <p className={styles.alertInstruction}>{p.instruction}</p>
                      )}
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {weather && (
          <div className={styles.data}>
            <div>
              <h2 className={styles.locationName}>{weather.location}</h2>
              <div className={styles.timestamp}>
                {new Date(weather.currentTime).toLocaleString('en-US', {
                  timeZone: weather.timezone,
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                  timeZoneName: 'short'
                })}
              </div>
            </div>

            <div className={styles.iconRow}>
              {getWeatherIcon(weather.conditions, weather.isNight)}
            </div>

            <div className={styles.unitToggleRow}>
              <button
                onClick={() => setUnit(unit === 'F' ? 'C' : 'F')}
                className={styles.unitToggle}
              >
                Switch to {unit === 'F' ? 'Centigrade' : 'Fahrenheit'}
              </button>
            </div>

            <div className={styles.statsGrid}>
              <div className={`${styles.statCard} ${styles.temp}`}>
                <div className={styles.statLabel}>
                  Temperature
                </div>
                <div className={styles.statValue}>
                  {convertTemp(weather.temperature)}°{unit}
                </div>
                {weather.forecast && (
                  <div className={styles.forecast}>
                    {weather.forecast.temperatures.map((temp, i) => (
                      <div key={i} className={styles.forecastDay}>
                        <div className={styles.forecastDayName}>
                          {new Date(weather.forecast.dates[i]).toLocaleDateString('en-US', { weekday: 'short' })}
                        </div>
                        <div className={styles.forecastDayHigh}>
                          {convertTemp(temp)}°
                        </div>
                        <div className={styles.forecastDayLow}>
                          {convertTemp(weather.forecast.temperaturesMins[i])}°
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className={`${styles.statCard} ${styles.conditions}`}>
                <div className={styles.statLabel}>
                  Conditions
                </div>
                <div className={styles.conditionsValue}>
                  {weather.conditions}
                </div>
                {weather.forecast && (
                  <div className={styles.forecast}>
                    {weather.forecast.conditions.map((condition, i) => (
                      <div key={i} className={styles.forecastDay}>
                        <div className={styles.forecastDayName}>
                          {new Date(weather.forecast.dates[i]).toLocaleDateString('en-US', { weekday: 'short' })}
                        </div>
                        <div className={styles.forecastConditionsText}>
                          {condition}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className={`${styles.statCard} ${styles.dewpoint}`}>
                <div className={styles.statLabel}>
                  Dew Point
                </div>
                <div className={styles.dewpointValue}>
                  {convertTemp(weather.dewPoint)}°{unit} - <span className={styles.dewpointLabel}>
                    {weather.dewPointLabel}
                  </span>
                </div>
                {weather.forecast && (
                  <div className={styles.forecast}>
                    {weather.forecast.dewPoints.map((dp, i) => (
                      <div key={i} className={styles.forecastDay}>
                        <div className={styles.forecastDayName}>
                          {new Date(weather.forecast.dates[i]).toLocaleDateString('en-US', { weekday: 'short' })}
                        </div>
                        <div className={styles.forecastDayHigh}>
                          {convertTemp(dp)}°
                        </div>
                        <div className={styles.forecastDayDplabel}>
                          {getDewPointLabel(dp)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
