module.exports = {
  apps: [{
    name: 'webrtc-signaling',
    script: 'server.js',
    
    // PM2 options
    instances: 'max', // Use all CPU cores
    exec_mode: 'cluster',
    
    // Environment variables
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    
    // Logging
    log_file: './logs/app.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // Auto restart options
    max_restarts: 10,
    min_uptime: '10s',
    max_memory_restart: '1G',
    
    // Monitoring
    monitoring: false,
    
    // Advanced options
    watch: false, // Set to true in development
    ignore_watch: ['node_modules', 'logs'],
    
    // Graceful shutdown
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000,
    
    // Source map support (optional)
    source_map_support: false,
    
    // Merge logs from all instances
    merge_logs: true
  }]
};