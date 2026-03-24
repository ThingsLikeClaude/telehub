module.exports = {
  apps: [
    {
      name: 'telehub',
      script: 'npx',
      args: 'tsx src/app.ts',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
      watch: false,
      max_memory_restart: '500M',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
