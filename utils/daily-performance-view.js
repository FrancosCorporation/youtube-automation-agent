'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const DATE_FILE = /^\d{4}-\d{2}-\d{2}\.json$/;

function publicReport(report) {
  if (!report || !/^\d{4}-\d{2}-\d{2}$/.test(report.reportDate || '') || !Array.isArray(report.posts)) return null;
  const coverage = report.coverage && typeof report.coverage === 'object' ? report.coverage : {};
  const posts = report.posts.filter(post => post && typeof post === 'object').map(post => {
    const verifiedMetrics = post.simulated !== true && post.source === 'youtube_official_apis';
    const hasUnverifiedMetrics = !verifiedMetrics && Boolean(post.counters || post.analytics);
    return {
    publicationId: String(post.publicationId || ''),
    platform: String(post.platform || 'unknown'),
    title: String(post.title || 'Untitled video'),
    formatId: report.schemaVersion >= 2 && post.formatProvenance === 'explicit' ? String(post.formatId || 'unknown') : 'unknown',
    formatProvenance: report.schemaVersion >= 2 ? String(post.formatProvenance || 'unknown') : 'unknown',
    formatVersion: report.schemaVersion >= 2 && post.formatProvenance === 'explicit'
      ? finiteOrNull(post.formatVersion) : null,
    experimentId: report.schemaVersion >= 2 && post.experimentProvenance === 'explicit'
      && /^[A-Za-z0-9_-]{8,80}$/.test(String(post.experimentId || '')) ? post.experimentId : null,
    experimentProvenance: report.schemaVersion >= 2 ? String(post.experimentProvenance || 'unknown') : 'unknown',
    surfaceId: String(post.surfaceId || 'unknown'),
    clipKind: typeof post.clipKind === 'string' ? post.clipKind : null,
    theme: typeof post.theme === 'string' ? post.theme : null,
    status: hasUnverifiedMetrics ? 'unverified' : String(post.status || 'unavailable'),
    reason: hasUnverifiedMetrics ? 'metric_provenance_missing' : typeof post.reason === 'string' ? post.reason : null,
    url: typeof post.url === 'string' && /^https:\/\//.test(post.url) ? post.url : null,
    confirmedAt: typeof post.confirmedAt === 'string' ? post.confirmedAt : null,
    publishedAt: typeof post.publishedAt === 'string' && Number.isFinite(Date.parse(post.publishedAt)) ? post.publishedAt : null,
    durationSeconds: finiteOrNull(post.durationSeconds),
    counters: verifiedMetrics && post.counters && typeof post.counters === 'object' ? {
      views: finiteOrNull(post.counters.views),
      engagedViews: finiteOrNull(post.counters.engagedViews),
      likes: finiteOrNull(post.counters.likes),
      comments: finiteOrNull(post.counters.comments),
      shares: finiteOrNull(post.counters.shares),
      averageViewDurationSeconds: finiteOrNull(post.counters.averageViewDurationSeconds),
      averageViewPercentage: finiteOrNull(post.counters.averageViewPercentage)
    } : null,
    delta: verifiedMetrics && post.delta && typeof post.delta === 'object' ? {
      hours: finiteOrNull(post.delta.hours),
      viewsPer24Hours: finiteOrNull(post.delta.viewsPer24Hours),
      metrics: {
        views: finiteOrNull(post.delta.metrics?.views),
        likes: finiteOrNull(post.delta.metrics?.likes),
        comments: finiteOrNull(post.delta.metrics?.comments)
      }
    } : null,
    analytics: verifiedMetrics && post.analytics && typeof post.analytics === 'object' ? {
      status: String(post.analytics.status || 'unavailable'),
      reason: typeof post.analytics.reason === 'string' ? post.analytics.reason : null,
      availableThrough: typeof post.analytics.availableThrough === 'string' ? post.analytics.availableThrough : null,
      days: Array.isArray(post.analytics.days) ? post.analytics.days.slice(-14).map(day => ({
        date: day.date,
        metrics: day.metrics && typeof day.metrics === 'object' ? {
          views: finiteOrNull(day.metrics.views),
          engagedViews: finiteOrNull(day.metrics.engagedViews),
          estimatedMinutesWatched: finiteOrNull(day.metrics.estimatedMinutesWatched),
          averageViewDurationSeconds: finiteOrNull(day.metrics.averageViewDurationSeconds),
          averageViewPercentage: finiteOrNull(day.metrics.averageViewPercentage)
        } : {}
      })) : []
    } : post.analytics ? { status: 'unverified', reason: 'metric_provenance_missing', availableThrough: null, days: [] } : null
    };
  });
  return {
    reportDate: report.reportDate,
    collectedAt: typeof report.collectedAt === 'string' ? report.collectedAt : null,
    timeZone: String(report.timeZone || 'America/Sao_Paulo'),
    status: report.status === 'observed' && posts.some(post => post.status === 'unverified') ? 'partial' : String(report.status || 'unavailable'),
    coverage,
    publicationHealth: report.publicationHealth && typeof report.publicationHealth === 'object'
      ? Object.fromEntries(Object.entries(report.publicationHealth).map(([platform, health]) => [platform, {
        confirmed: finiteOrNull(health?.confirmed),
        attempting: finiteOrNull(health?.attempting),
        failed: finiteOrNull(health?.failed),
        unknown: finiteOrNull(health?.unknown),
        lastConfirmedAt: typeof health?.lastConfirmedAt === 'string' ? health.lastConfirmedAt : null,
        latestAttemptAt: typeof health?.latestAttemptAt === 'string' ? health.latestAttemptAt : null,
        latestAttemptStatus: typeof health?.latestAttemptStatus === 'string' ? health.latestAttemptStatus : null,
        latestFailureCode: typeof health?.latestFailureCode === 'string' ? health.latestFailureCode : null
      }])) : {},
    posts
  };
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

async function readDailyPerformanceReports(reportDir, limit = 14) {
  const safeLimit = Math.max(1, Math.min(31, Math.floor(Number(limit) || 14)));
  let entries;
  try { entries = await fs.readdir(reportDir, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return { status: 'not_available', reports: [] }; throw error; }
  const files = entries.filter(entry => entry.isFile() && DATE_FILE.test(entry.name))
    .map(entry => entry.name).sort().slice(-safeLimit).reverse();
  const reports = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(reportDir, file), 'utf8'));
      const report = publicReport(parsed);
      if (report && file.slice(0, 10) === report.reportDate) reports.push(report);
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) continue;
      throw error;
    }
  }
  return {
    status: reports[0]?.status || (files.length ? 'unavailable' : 'not_available'),
    latestDate: reports[0]?.reportDate || null,
    reports
  };
}

module.exports = { publicReport, readDailyPerformanceReports };
