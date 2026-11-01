'use strict';

// Read-only metrics shared by the animated pipeline and the existing analytics
// agent. Never invokes text generation or the agent's simulated fallbacks.
const METRICS = Object.freeze([
  'views', 'engagedViews', 'estimatedMinutesWatched', 'averageViewDuration',
  'averageViewPercentage', 'likes', 'comments', 'shares',
  'subscribersGained', 'subscribersLost'
]);
const REQUEST_OPTIONS = Object.freeze({ timeout: 20000, retry: false });

function optionalMetric(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= Number.MAX_SAFE_INTEGER ? number : null;
}

function analyticsErrorCode(error) {
  const body = error?.response?.data?.error;
  const reasons = Array.isArray(body?.errors) ? body.errors.map(item => String(item?.reason || '').toLowerCase()) : [];
  const message = [body?.message, error?.response?.data?.error_description, error?.message]
    .filter(value => typeof value === 'string').join(' ').toLowerCase();
  const status = Number(error?.response?.status || error?.status || error?.code);
  if (body === 'invalid_grant' || body?.message === 'invalid_grant'
      || error?.response?.data?.error_description === 'invalid_grant') return 'oauth_invalid_grant';
  if (status === 401) return 'authentication_required';
  if (reasons.some(reason => ['accessnotconfigured', 'servicedisabled'].includes(reason))
      || /api has not been used in project .* or it is disabled|api .* is disabled/.test(message)) return 'api_disabled';
  if (reasons.some(reason => /quota|ratelimit|dailylimit|userratelimit/.test(reason))) return 'quota_exceeded';
  if (reasons.some(reason => /permission|forbidden|authentication/.test(reason))) return 'permission_denied';
  if (status === 403) return 'permission_or_quota_denied';
  if (status === 429) return 'rate_limited';
  if (['ETIMEDOUT', 'ECONNABORTED', 'ECONNRESET'].includes(error?.code)) return 'transport_error';
  return 'api_unavailable';
}

function calendarDate(now, timeZone = 'America/Sao_Paulo') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(now));
}

function dateOffset(date, days) {
  return new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

function isoDurationSeconds(value) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value || '');
  return match && match.slice(1).some(Boolean)
    ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : null;
}

async function collectYouTubeVideoMetrics({ youtube, analytics, videoId, channelId, now = new Date() }) {
  if (!/^[\w-]{11}$/.test(videoId || '') || !channelId) throw new TypeError('identidade de vídeo/canal inválida');
  const observedAt = new Date(now).toISOString();
  const endDate = dateOffset(calendarDate(now, 'America/Los_Angeles'), -1);
  const startDate = dateOffset(endDate, -29);
  const response = await youtube.videos.list({
    part: 'snippet,statistics,contentDetails,status', id: videoId
  }, REQUEST_OPTIONS);
  const video = response.data?.items?.find(item => item.id === videoId);
  if (!video) return { status: 'unavailable', reason: 'video_not_found', observedAt };
  if (video.snippet?.channelId !== channelId) return { status: 'unavailable', reason: 'account_mismatch', observedAt };
  const result = {
    status: 'partial', observedAt, source: 'youtube_official_apis', simulated: false,
    publishedAt: video.snippet?.publishedAt || null,
    durationSeconds: isoDurationSeconds(video.contentDetails?.duration),
    privacyStatus: video.status?.privacyStatus || null,
    counters: {
      views: optionalMetric(video.statistics?.viewCount),
      likes: optionalMetric(video.statistics?.likeCount),
      comments: optionalMetric(video.statistics?.commentCount)
    },
    analytics: {
      status: 'unavailable', startDate, requestedEndDate: endDate,
      timeZone: 'America/Los_Angeles', availableThrough: null, days: []
    }
  };
  try {
    const report = await analytics.reports.query({
      ids: 'channel==MINE', startDate, endDate, dimensions: 'day',
      metrics: METRICS.join(','), filters: 'video==' + videoId, sort: 'day'
    }, REQUEST_OPTIONS);
    const columns = (report.data?.columnHeaders || []).map(column => column.name);
    const dayIndex = columns.indexOf('day');
    if (dayIndex < 0) throw new Error('invalid_metrics_schema');
    result.analytics.days = (report.data?.rows || []).map(row => ({
      date: row[dayIndex],
      metrics: Object.fromEntries(METRICS.map(name => [name, optionalMetric(row[columns.indexOf(name)])]))
    })).filter(row => typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date)
      && row.date >= startDate && row.date <= endDate).sort((a, b) => a.date.localeCompare(b.date));
    const hasAnyMetric = result.analytics.days.some(day => Object.values(day.metrics).some(Number.isFinite));
    const complete = hasAnyMetric && result.analytics.days.every(day => METRICS.every(name => Number.isFinite(day.metrics[name])));
    result.analytics.availableThrough = hasAnyMetric ? result.analytics.days.at(-1)?.date || null : null;
    result.analytics.status = complete ? 'observed' : hasAnyMetric ? 'partial' : 'no_data';
    result.status = complete ? 'observed' : 'partial';
    if (!complete) result.analytics.reason = hasAnyMetric ? 'metrics_incomplete' : 'analytics_not_yet_available';
  } catch (error) {
    result.analytics.reason = analyticsErrorCode(error);
  }
  return result;
}

module.exports = { METRICS, REQUEST_OPTIONS, optionalMetric, analyticsErrorCode, calendarDate, dateOffset, collectYouTubeVideoMetrics };
