const winston = require('winston');
const path = require('path');
const chalk = require('chalk');
const { sanitizeLogData, sanitizeLogText } = require('./log-sanitizer');

const LOG_ROTATION = Object.freeze({
  combined: Object.freeze({ maxsize: 5 * 1024 * 1024, maxFiles: 5 }),
  error: Object.freeze({ maxsize: 5 * 1024 * 1024, maxFiles: 3 }),
  component: Object.freeze({ maxsize: 2 * 1024 * 1024, maxFiles: 3 })
});

class Logger {
  constructor(component = 'System', options = {}) {
    this.component = String(component || 'System').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'System';
    this.logDir = options.logDir || path.join(__dirname, '..', 'logs');
    this.rotation = options.rotation || LOG_ROTATION;
    this.winston = this.createWinstonLogger();
  }

  createWinstonLogger() {
    return winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { component: this.component },
      transports: [
        // Write all logs to combined.log
        new winston.transports.File({ 
          filename: path.join(this.logDir, 'combined.log'),
          ...this.rotation.combined
        }),
        
        // Write error logs to error.log
        new winston.transports.File({ 
          filename: path.join(this.logDir, 'error.log'),
          level: 'error',
          ...this.rotation.error
        }),
        
        // Write agent-specific logs
        new winston.transports.File({
          filename: path.join(this.logDir, `${this.component.toLowerCase()}.log`),
          ...this.rotation.component
        })
      ]
    });
  }

  info(message, ...args) {
    const safeMessage = sanitizeLogText(message);
    this.winston.info(safeMessage, ...sanitizeLogData(args));
    console.log(this.formatConsoleMessage('INFO', safeMessage, chalk.blue));
  }

  success(message, ...args) {
    const safeMessage = sanitizeLogText(message);
    this.winston.info(safeMessage, ...sanitizeLogData(args));
    console.log(this.formatConsoleMessage('SUCCESS', safeMessage, chalk.green));
  }

  warn(message, ...args) {
    const safeMessage = sanitizeLogText(message);
    this.winston.warn(safeMessage, ...sanitizeLogData(args));
    console.log(this.formatConsoleMessage('WARN', safeMessage, chalk.yellow));
  }

  error(message, error = null, ...args) {
    const safeMessage = sanitizeLogText(message);
    const safeArgs = sanitizeLogData(args);
    if (error) {
      const safeError = sanitizeLogData(error);
      const additional = Object.assign({}, ...safeArgs.filter(item => item && typeof item === 'object' && !Array.isArray(item)));
      this.winston.error(safeMessage, { error: safeError, ...additional });
    } else {
      this.winston.error(safeMessage, ...safeArgs);
    }
    console.log(this.formatConsoleMessage('ERROR', safeMessage, chalk.red));
    if (error && process.env.NODE_ENV !== 'production') {
      const safeError = sanitizeLogData(error);
      if (safeError?.stack) console.error(chalk.red(safeError.stack));
    }
  }

  debug(message, ...args) {
    const safeMessage = sanitizeLogText(message);
    this.winston.debug(safeMessage, ...sanitizeLogData(args));
    if (process.env.NODE_ENV !== 'production') {
      console.log(this.formatConsoleMessage('DEBUG', safeMessage, chalk.gray));
    }
  }

  formatConsoleMessage(level, message, colorFunc) {
    const timestamp = new Date().toLocaleTimeString();
    const componentTag = chalk.cyan(`[${this.component}]`);
    const levelTag = colorFunc(`[${level}]`);
    
    return `${chalk.gray(timestamp)} ${componentTag} ${levelTag} ${sanitizeLogText(message)}`;
  }

  // Method to create specialized loggers for different purposes
  static createAgentLogger(agentName) {
    return new Logger(agentName);
  }

  static createSystemLogger() {
    return new Logger('System');
  }

  static createAPILogger() {
    return new Logger('API');
  }

  // Performance logging
  startTimer(label, context = {}) {
    const startTime = Date.now();
    return {
      end: () => {
        const duration = Date.now() - startTime;
        const operation = sanitizeLogText(label);
        this.winston.info('Operation timing', sanitizeLogData({
          ...context,
          operation,
          durationMs: duration
        }));
        console.log(this.formatConsoleMessage('INFO', `${operation} completed in ${duration}ms`, chalk.blue));
        return duration;
      }
    };
  }

  // Structured logging for important events
  logEvent(eventType, data = {}) {
    const safeData = sanitizeLogData(data);
    this.winston.info('System Event', {
      ...safeData,
      eventType: sanitizeLogText(eventType),
      timestamp: new Date().toISOString()
    });
  }

  // Log content generation pipeline
  logContentPipeline(stage, contentId, status, data = {}) {
    const safeData = sanitizeLogData(data);
    this.winston.info('Content Pipeline', {
      ...safeData,
      stage: sanitizeLogText(stage),
      contentId: sanitizeLogText(contentId),
      videoId: sanitizeLogText(safeData.videoId || contentId),
      jobId: safeData.jobId || null,
      destination: safeData.destination || safeData.platform || 'unknown',
      status: sanitizeLogText(status),
      timestamp: new Date().toISOString(),
    });
  }

  // Log publishing events
  logPublishing(action, videoId, status, data = {}) {
    const safeData = sanitizeLogData(data);
    this.winston.info('Publishing Event', {
      ...safeData,
      action: sanitizeLogText(action),
      videoId: sanitizeLogText(videoId),
      jobId: safeData.jobId || null,
      destination: safeData.destination || safeData.platform || 'unknown',
      status: sanitizeLogText(status),
      timestamp: new Date().toISOString(),
    });
  }

  // Log analytics events
  logAnalytics(videoId, metrics, insights = []) {
    const insightCount = Array.isArray(insights) ? insights.length : 0;
    this.winston.info('Analytics Update', {
      videoId: sanitizeLogText(videoId),
      metrics: sanitizeLogData(metrics),
      insightsCount: insightCount,
      timestamp: new Date().toISOString()
    });
  }

  // Log errors with context
  logErrorWithContext(error, context = {}) {
    this.winston.error('System Error', {
      error: sanitizeLogData(error),
      context: sanitizeLogData(context),
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = { LOG_ROTATION, Logger };
