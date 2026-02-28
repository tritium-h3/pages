import React, { useState, useEffect } from 'react';
import { Cloud, CloudRain, Sun, CloudSnow, Wind, MapPin, Moon } from 'lucide-react';
import './WeatherApp.css';

const WeatherApp = () => {
  const [location, setLocation] = useState(
    () => new URLSearchParams(window.location.search).get('loc') || ''
  );
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [gettingLocation, setGettingLocation] = useState(false);
  const [unit, setUnit] = useState('F'); // 'F' or 'C'
  const [alerts, setAlerts] = useState<any[]>([]);

  const convertTemp = (tempF) => {
    if (unit === 'C') {
      return Math.round((tempF - 32) * 5/9);
    }
    return Math.round(tempF);
  };

  const getDewPointLabel = (dewPoint) => {
    if (dewPoint < 40) return 'crispy';
    if (dewPoint < 50) return 'dry';
    if (dewPoint < 60) return 'comfy';
    if (dewPoint < 70) return 'dank';
    return 'oppressive';
  };

  const getWeatherIcon = (conditions, isNight = false) => {
    const lower = conditions.toLowerCase();
    if (lower.includes('rain') || lower.includes('drizzle')) {
      return <CloudRain className="w-16 h-16 text-blue-500" />;
    }
    if (lower.includes('snow')) {
      return <CloudSnow className="w-16 h-16 text-blue-300" />;
    }
    if (lower.includes('cloud') || lower.includes('overcast')) {
      return <Cloud className="w-16 h-16 text-gray-500" />;
    }
    if (lower.includes('wind')) {
      return <Wind className="w-16 h-16 text-gray-600" />;
    }
    return isNight 
      ? <Moon className="w-16 h-16 text-indigo-300" />
      : <Sun className="w-16 h-16 text-yellow-500" />;
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

  const fetchWeatherByCoords = async (lat, lon) => {
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
      const forecastDewPoints = weatherData.daily.temperature_2m_max.map((maxTemp, i) => {
        const minTemp = weatherData.daily.temperature_2m_min[i];
        const avgTempF = (maxTemp + minTemp) / 2;
        const avgTempC = (avgTempF - 32) * 5/9;
        const estimatedRH = 70;
        const alpha = ((a * avgTempC) / (b + avgTempC)) + Math.log(estimatedRH / 100);
        const dewPointC = (b * alpha) / (a - alpha);
        return Math.round((dewPointC * 9/5) + 32);
      });
      
      const weatherCodes = {
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
        99: 'Thunderstorm with Hail'
      };
      
      const conditions = weatherCodes[weatherData.current.weather_code] || 'Unknown';
      const forecastConditions = weatherData.daily.weather_code.map(code => 
        weatherCodes[code] || 'Unknown'
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
      console.error('❌ Error fetching weather by coords:', err);
      console.error('Error details:', { message: err.message, stack: err.stack });
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
      const forecastDewPoints = weatherData.daily.temperature_2m_max.map((maxTemp, i) => {
        const minTemp = weatherData.daily.temperature_2m_min[i];
        const avgTempF = (maxTemp + minTemp) / 2;
        const avgTempC = (avgTempF - 32) * 5/9;
        // Estimate RH at ~70% for dew point forecast (typical average)
        const estimatedRH = 70;
        const alpha = ((a * avgTempC) / (b + avgTempC)) + Math.log(estimatedRH / 100);
        const dewPointC = (b * alpha) / (a - alpha);
        return Math.round((dewPointC * 9/5) + 32);
      });
      
      const weatherCodes = {
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
        99: 'Thunderstorm with Hail'
      };
      
      const conditions = weatherCodes[weatherData.current.weather_code] || 'Unknown';
      
      // Get forecast conditions
      const forecastConditions = weatherData.daily.weather_code.map(code => 
        weatherCodes[code] || 'Unknown'
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
      console.error('❌ Error in fetchWeather:', err);
      console.error('Error details:', { message: err.message, stack: err.stack });
      setError('Failed to fetch weather data');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
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
    <div className="weather-app">
      <div className="weather-card">
        <h1 className="weather-title">
          Weather Forecast
        </h1>
        
        <div className="weather-search-row">
          <div className="weather-search-inputs">
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Enter city name"
              className="weather-input"
            />
            <button
              onClick={getUserLocation}
              disabled={gettingLocation || loading}
              title="Use my location"
              className="weather-location-btn"
            >
              <MapPin size={20} />
            </button>
            <button
              onClick={fetchWeather}
              disabled={loading}
              className="weather-search-btn"
            >
              {loading ? 'Loading...' : 'Search'}
            </button>
          </div>
        </div>
        
        {error && (
          <div className="weather-error">
            <p>{error}</p>
          </div>
        )}

        {alerts.length > 0 && (
          <div className="weather-alerts">
            {alerts.map((alert, i) => {
              const p = alert.properties;
              const severity = (p.severity || 'unknown').toLowerCase();
              return (
                <div key={i} className={`weather-alert weather-alert--${severity}`}>
                  <div className="weather-alert-header">
                    <span className="weather-alert-event">{p.event}</span>
                    <span className="weather-alert-badge">{p.severity}</span>
                  </div>
                  {p.headline && (
                    <div className="weather-alert-headline">{p.headline}</div>
                  )}
                  {(p.description || p.instruction) && (
                    <details className="weather-alert-details">
                      <summary>Details</summary>
                      {p.description && <p>{p.description}</p>}
                      {p.instruction && (
                        <p className="weather-alert-instruction">{p.instruction}</p>
                      )}
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {weather && (
          <div className="weather-data">
            <div>
              <h2 className="weather-location-name">{weather.location}</h2>
              <div className="weather-timestamp">
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
            
            <div className="weather-icon-row">
              {getWeatherIcon(weather.conditions, weather.isNight)}
            </div>
            
            <div className="weather-unit-toggle-row">
              <button
                onClick={() => setUnit(unit === 'F' ? 'C' : 'F')}
                className="weather-unit-toggle"
              >
                Switch to {unit === 'F' ? 'Centigrade' : 'Fahrenheit'}
              </button>
            </div>
            
            <div className="weather-stats-grid">
              <div className="weather-stat-card temp">
                <div className="weather-stat-label">
                  Temperature
                </div>
                <div className="weather-stat-value">
                  {convertTemp(weather.temperature)}°{unit}
                </div>
                {weather.forecast && (
                  <div className="weather-forecast">
                    {weather.forecast.temperatures.map((temp, i) => (
                      <div key={i} className="forecast-day">
                        <div className="forecast-day-name">
                          {new Date(weather.forecast.dates[i]).toLocaleDateString('en-US', { weekday: 'short' })}
                        </div>
                        <div className="forecast-day-high">
                          {convertTemp(temp)}°
                        </div>
                        <div className="forecast-day-low">
                          {convertTemp(weather.forecast.temperaturesMins[i])}°
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <div className="weather-stat-card conditions">
                <div className="weather-stat-label">
                  Conditions
                </div>
                <div className="weather-conditions-value">
                  {weather.conditions}
                </div>
                {weather.forecast && (
                  <div className="weather-forecast">
                    {weather.forecast.conditions.map((condition, i) => (
                      <div key={i} className="forecast-day">
                        <div className="forecast-day-name">
                          {new Date(weather.forecast.dates[i]).toLocaleDateString('en-US', { weekday: 'short' })}
                        </div>
                        <div className="forecast-conditions-text">
                          {condition}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <div className="weather-stat-card dewpoint">
                <div className="weather-stat-label">
                  Dew Point
                </div>
                <div className="weather-dewpoint-value">
                  {convertTemp(weather.dewPoint)}°{unit} - <span className="weather-dewpoint-label">
                    {weather.dewPointLabel}
                  </span>
                </div>
                {weather.forecast && (
                  <div className="weather-forecast">
                    {weather.forecast.dewPoints.map((dp, i) => (
                      <div key={i} className="forecast-day">
                        <div className="forecast-day-name">
                          {new Date(weather.forecast.dates[i]).toLocaleDateString('en-US', { weekday: 'short' })}
                        </div>
                        <div className="forecast-day-high">
                          {convertTemp(dp)}°
                        </div>
                        <div className="forecast-day-dplabel">
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
};

export default WeatherApp;