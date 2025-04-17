export default {
    async fetch(request, env, ctx) {
      // Check if the request is a WebSocket upgrade request
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
  
      // Create the WebSocket pair
      const [client, server] = Object.values(new WebSocketPair());
  
      // Accept the WebSocket connection
      server.accept();
  
      // Set up the simulation environment
      const simulationData = {
        // Initial boat position (somewhere in San Francisco Bay)
        latitude: 37.8199, 
        longitude: -122.4783,
        // Boat speed in knots
        boatSpeed: 5.5,
        // Course over ground in degrees
        cog: 225,
        // True wind speed in knots
        tws: 12,
        // True wind direction in degrees
        twd: 270,
        // Time counter
        time: Date.now(),
        // Last update timestamp
        lastUpdate: Date.now()
      };
  
      // Function to calculate apparent wind
      const calculateApparentWind = (tws, twd, boatSpeed, cog) => {
        // Convert degrees to radians
        const twdRad = (twd * Math.PI) / 180;
        const cogRad = (cog * Math.PI) / 180;
        
        // Calculate true wind components
        const twx = tws * Math.sin(twdRad);
        const twy = tws * Math.cos(twdRad);
        
        // Calculate boat velocity components
        const bvx = boatSpeed * Math.sin(cogRad);
        const bvy = boatSpeed * Math.cos(cogRad);
        
        // Calculate apparent wind components
        const awx = twx - bvx;
        const awy = twy - bvy;
        
        // Calculate apparent wind speed and angle
        const aws = Math.sqrt(awx * awx + awy * awy);
        let awa = (Math.atan2(awx, awy) * 180) / Math.PI;
        
        // Normalize AWA to be between -180 and 180
        if (awa > 180) awa -= 360;
        if (awa < -180) awa += 360;
        
        return { aws, awa };
      };
  
      // Function to generate NMEA checksum
      const generateChecksum = (str) => {
        let checksum = 0;
        for (let i = 1; i < str.length; i++) {
          checksum ^= str.charCodeAt(i);
        }
        return checksum.toString(16).toUpperCase().padStart(2, '0');
      };
  
      // Function to format NMEA GPS data (GLL sentence)
      const formatGLL = (latitude, longitude, time) => {
        const date = new Date(time);
        const hours = date.getUTCHours().toString().padStart(2, '0');
        const minutes = date.getUTCMinutes().toString().padStart(2, '0');
        const seconds = date.getUTCSeconds().toString().padStart(2, '0');
        const timeString = `${hours}${minutes}${seconds}`;
        
        const latDeg = Math.floor(Math.abs(latitude));
        const latMin = ((Math.abs(latitude) - latDeg) * 60).toFixed(4);
        const latDir = latitude >= 0 ? 'N' : 'S';
        const latString = `${latDeg.toString().padStart(2, '0')}${latMin.padStart(7, '0')}`;
        
        const lonDeg = Math.floor(Math.abs(longitude));
        const lonMin = ((Math.abs(longitude) - lonDeg) * 60).toFixed(4);
        const lonDir = longitude >= 0 ? 'E' : 'W';
        const lonString = `${lonDeg.toString().padStart(3, '0')}${lonMin.padStart(7, '0')}`;
        
        const sentence = `$GPGLL,${latString},${latDir},${lonString},${lonDir},${timeString},A`;
        return `${sentence}*${generateChecksum(sentence)}`;
      };
  
      // Function to format NMEA wind data (MWV sentence for apparent wind)
      const formatMWV = (angle, speed) => {
        // Normalize angle to 0-359
        let normAngle = angle;
        if (normAngle < 0) normAngle += 360;
        
        const angleStr = normAngle.toFixed(1);
        const speedStr = speed.toFixed(1);
        
        const sentence = `$IIMWV,${angleStr},R,${speedStr},N,A`;
        return `${sentence}*${generateChecksum(sentence)}`;
      };
  
      // Function to format NMEA boat speed (VHW sentence)
      const formatVHW = (cog, boatSpeed) => {
        const cogStr = cog.toFixed(1);
        const speedStr = boatSpeed.toFixed(1);
        
        const sentence = `$IIVHW,${cogStr},T,${cogStr},M,${speedStr},N,${(boatSpeed * 1.852).toFixed(1)},K`;
        return `${sentence}*${generateChecksum(sentence)}`;
      };
  
      // Function to update boat position based on speed and course
      const updatePosition = (data, elapsedSec) => {
        // Convert knots to degrees per second (very rough approximation)
        const speedDegPerSec = data.boatSpeed / 60 / 60;
        const cogRad = (data.cog * Math.PI) / 180;
        
        // Update position
        data.longitude += Math.sin(cogRad) * speedDegPerSec * elapsedSec;
        data.latitude += Math.cos(cogRad) * speedDegPerSec * elapsedSec;
        
        // Simulate some natural variation in boat speed and course
        data.boatSpeed += (Math.random() - 0.5) * 0.1;
        // Keep speed in reasonable range
        data.boatSpeed = Math.max(2, Math.min(8, data.boatSpeed));
        
        data.cog += (Math.random() - 0.5) * 1;
        // Normalize course to 0-359
        data.cog = (data.cog + 360) % 360;
        
        // Also vary the true wind slightly
        data.tws += (Math.random() - 0.5) * 0.2;
        data.tws = Math.max(5, Math.min(20, data.tws));
        
        data.twd += (Math.random() - 0.5) * 2;
        data.twd = (data.twd + 360) % 360;
      };
  
      // Set up interval to send data
      const intervalId = setInterval(() => {
        if (server.readyState !== 1) { // Check if connection is still open
          clearInterval(intervalId);
          return;
        }
  
        // Calculate elapsed time
        const now = Date.now();
        const elapsedSec = (now - simulationData.lastUpdate) / 1000;
        simulationData.time = now;
        
        // Update boat position and parameters
        updatePosition(simulationData, elapsedSec);
        simulationData.lastUpdate = now;
        
        // Calculate apparent wind
        const apparentWind = calculateApparentWind(
          simulationData.tws,
          simulationData.twd,
          simulationData.boatSpeed,
          simulationData.cog
        );
        
        // Generate NMEA sentences
        const gllSentence = formatGLL(simulationData.latitude, simulationData.longitude, simulationData.time);
        const mwvSentence = formatMWV(apparentWind.awa, apparentWind.aws);
        const vhwSentence = formatVHW(simulationData.cog, simulationData.boatSpeed);
        
        // Send data to client
        server.send(`${gllSentence}\r\n${mwvSentence}\r\n${vhwSentence}`);
      }, 1000); // Send data every second
  
      // Handle WebSocket closure
      server.addEventListener("close", () => {
        clearInterval(intervalId);
      });
  
      // Handle WebSocket errors
      server.addEventListener("error", () => {
        clearInterval(intervalId);
      });
  
      // Return the client end of the WebSocket to the client
      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    },
  };