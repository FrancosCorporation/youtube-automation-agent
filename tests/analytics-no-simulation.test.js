'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AnalyticsOptimizationAgent } = require('../agents/analytics-optimization-agent');
const { ContentStrategyAgent } = require('../agents/content-strategy-agent');
const { ChannelLearningEngine } = require('../utils/channel-learning-engine');

test('analytics API failure is unavailable and cannot turn into generated counters', async () => {
  const agent = Object.create(AnalyticsOptimizationAgent.prototype);
  agent.logger = { error() {} };
  for (const name of ['getViewsAnalytics', 'getWatchTimeAnalytics', 'getDemographicsAnalytics', 'getTrafficSourcesAnalytics', 'getDeviceAnalytics', 'getOutcomeAnalytics']) {
    agent[name] = async () => { throw new Error('private api failure detail'); };
  }
  await assert.rejects(agent.getVideoAnalytics('abcdefghijk', { startDate: '2026-10-01', endDate: '2026-10-15' }), error => {
    assert.equal(error.code, 'analytics_unavailable');
    assert.equal(error.message, 'Observed YouTube analytics are unavailable');
    return true;
  });
});

test('demographic failures stay empty and primary audience is never invented', async () => {
  const agent = Object.create(AnalyticsOptimizationAgent.prototype);
  agent.youtubeAnalytics = { reports: { query: async () => { throw new Error('unavailable'); } } };
  const result = await agent.getDemographicsAnalytics('abcdefghijk', '2026-10-01', '2026-10-15');
  assert.deepEqual(result, {
    available: false, simulated: false, reason: 'demographics_unavailable', ageGroups: [], gender: [], primaryAudience: null
  });
  assert.equal(agent.identifyPrimaryAudience([], []), null);
});

test('successful API calls with empty result rows remain unavailable, not zero', async () => {
  const agent = Object.create(AnalyticsOptimizationAgent.prototype);
  agent.logger = { info() {}, warn() {} };
  agent.youtubeAnalytics = { reports: { query: async () => ({ data: { rows: [] } }) } };
  const views = await agent.getViewsAnalytics('abcdefghijk', '2026-10-01', '2026-10-15');
  assert.equal(views.totalViews, null);
  assert.equal(views.totalImpressions, null);
  assert.equal(views.averageCTR, null);
  const watchTime = await agent.getWatchTimeAnalytics('abcdefghijk', '2026-10-01', '2026-10-15');
  assert.equal(watchTime.totalWatchTime, null);
  assert.equal(watchTime.averageViewPercentage, null);
  const traffic = await agent.getTrafficSourcesAnalytics('abcdefghijk', '2026-10-01', '2026-10-15');
  assert.equal(traffic.topSource, null);
  assert.equal(traffic.organicPercentage, null);
  const devices = await agent.getDeviceAnalytics('abcdefghijk', '2026-10-01', '2026-10-15');
  assert.equal(devices.mobilePercentage, null);
  const outcomes = await agent.getOutcomeAnalytics('abcdefghijk', '2026-10-01', '2026-10-15');
  assert.equal(outcomes.subscribersAvailable, false);
  assert.equal(outcomes.netSubscribers, null);
  assert.equal(outcomes.revenueAvailable, false);
  const thumbnail = await agent.analyzeThumbnailPerformance('abcdefghijk', { startDate: '2026-10-01', endDate: '2026-10-15' });
  assert.equal(thumbnail.impressions, null);
  assert.equal(thumbnail.clickThroughRate, null);
});

test('learning metrics preserve absent values as null', () => {
  const learning = Object.create(ChannelLearningEngine.prototype);
  const metrics = learning.normalizeMetrics({ analytics: {}, videoDetails: {}, performance: {} });
  for (const key of ['views', 'impressions', 'ctr', 'retention', 'averageViewDuration', 'watchMinutes', 'watchHours', 'engagementRate', 'performanceScore']) {
    assert.equal(metrics[key], null, `${key} must not be interpreted as a measured zero`);
  }
});

test('low-confidence observed snapshots cannot produce planning recommendations', async () => {
  const saved = [];
  const snapshots = ['tutorial-1', 'tutorial-2', 'list-1', 'list-2'].map((videoId, index) => ({
    videoId,
    simulated: false,
    confidence: 'low',
    measurementWindow: '7d',
    contentAttributes: { format: index < 2 ? 'tutorial' : 'list', surface: 'long_form' },
    metrics: {
      impressions: 99,
      views: 19,
      ctr: index < 2 ? 8 : 2,
      retention: index < 2 ? 70 : 20,
      performanceScore: index < 2 ? 90 : 40
    }
  }));
  const learning = new ChannelLearningEngine({
    listPerformanceSnapshots: async options => {
      assert.equal(options.reliableOnly, true);
      return snapshots;
    },
    getChannelStrategy: async () => null,
    saveLearningRecommendation: async recommendation => saved.push(recommendation)
  });

  assert.deepEqual(await learning.refreshRecommendations(), []);
  assert.equal(saved.length, 0);
});

test('medium-confidence evidence remains eligible for review-gated recommendations', async () => {
  const saved = [];
  const snapshots = ['tutorial-1', 'tutorial-2', 'list-1', 'list-2'].map((videoId, index) => ({
    videoId,
    simulated: false,
    confidence: 'medium',
    measurementWindow: '7d',
    contentAttributes: { format: index < 2 ? 'tutorial' : 'list', surface: 'long_form' },
    metrics: {
      impressions: 120,
      views: 25,
      ctr: index < 2 ? 8 : 2,
      retention: index < 2 ? 70 : 20,
      performanceScore: index < 2 ? 90 : 40
    }
  }));
  const learning = new ChannelLearningEngine({
    listPerformanceSnapshots: async () => snapshots,
    getChannelStrategy: async () => null,
    saveLearningRecommendation: async recommendation => {
      const result = { ...recommendation, status: 'pending' };
      saved.push(result);
      return result;
    }
  });

  const recommendations = await learning.refreshRecommendations();
  assert.ok(recommendations.some(item => item.category === 'format'));
  assert.ok(saved.every(item => item.status === 'pending'));
});

test('autonomous content planning queries only operator-approved learning', async () => {
  const allRecommendations = [
    { id: 'approved-one', status: 'approved', category: 'format', title: 'Prefer tutorial format', proposedChange: { target: 'future_plans' } },
    { id: 'pending-one', status: 'pending', category: 'format', title: 'Pending format idea', proposedChange: { target: 'future_plans' } }
  ];
  const queries = [];
  const agent = Object.create(ContentStrategyAgent.prototype);
  agent.db = {
    getAllRows: async () => [],
    listLearningRecommendations: async options => {
      queries.push(options);
      return allRecommendations.filter(item => item.status === options.status).slice(0, options.limit);
    }
  };
  agent.analyzeTrends = async function analyzeTrendsFixture() {
    this.trendingTopics = [];
    this.competitorData = [];
  };
  agent.trendingTopics = [];
  agent.competitorData = [];
  let prompt = '';
  agent.aiTextService = {
    isAvailable: () => true,
    generateText: async value => {
      prompt = value;
      return JSON.stringify([{ topic: 'A specific tutorial topic', pillar: 'Automation', angle: 'A useful angle', rationale: 'Fits the objective', format: 'tutorial', length: 'medium', sourceUrls: [] }]);
    }
  };

  const result = await agent.researchAndPlanChannel({
    objective: 'Teach practical automation',
    audience: 'Small teams',
    value_proposition: 'Useful guidance',
    contentPillars: ['Automation'],
    videos_per_run: 1,
    default_format: 'tutorial',
    default_length: 'medium'
  });

  assert.deepEqual(queries, [{ status: 'approved', limit: 10 }]);
  assert.deepEqual(result.research.approvedLearnings.map(item => item.title), ['Prefer tutorial format']);
  assert.match(prompt, /Prefer tutorial format/);
  assert.doesNotMatch(prompt, /Pending format idea/);
});

test('empty analytics cannot produce a numeric performance score or low-performance warning', async () => {
  const agent = Object.create(AnalyticsOptimizationAgent.prototype);
  const score = agent.calculatePerformanceScore({
    views: { totalViews: null, averageCTR: null },
    watchTime: { averageViewPercentage: null },
    engagement: { engagementRate: null }
  });
  assert.equal(score.score, null);
  assert.equal(score.grade, null);
  const insights = await agent.generateInsights({}, {
    views: { totalViews: null, averageCTR: null },
    watchTime: { averageViewPercentage: null },
    engagement: { engagementRate: null }
  }, { clickThroughRate: null }, { overallSEOScore: null });
  assert.deepEqual(insights, []);
  assert.equal(agent.calculateAverageScore([{ performance: { score: null } }, { performance: {} }]), null);
  assert.equal(agent.calculateAverageScore([{ performance: { score: null } }, { performance: { score: 60 } }]), 60);
  assert.deepEqual(agent.generateChannelInsights([{ performance: { score: null }, analytics: {} }]), []);
});

test('recent analytics excludes simulated and unverified legacy rows from rankings', async () => {
  const agent = Object.create(AnalyticsOptimizationAgent.prototype);
  const now = new Date().toISOString();
  const observed = {
    videoId: 'observed', analyzedAt: now,
    analytics: { simulated: false, watchTime: { averageViewPercentage: 45 } },
    performance: { score: 72 }
  };
  const simulated = {
    videoId: 'simulated', analyzedAt: now,
    analytics: { simulated: true, watchTime: { averageViewPercentage: 99 } },
    performance: { score: 100 }
  };
  const unverifiedLegacy = {
    videoId: 'legacy', analyzedAt: now,
    analytics: { watchTime: { averageViewPercentage: 99 } },
    performance: { score: 100 }
  };
  agent.performanceData = new Map([
    [observed.videoId, observed],
    [simulated.videoId, simulated],
    [unverifiedLegacy.videoId, unverifiedLegacy]
  ]);

  const result = await agent.getRecentAnalytics();
  assert.equal(result.totalVideos, 1);
  assert.equal(result.averagePerformanceScore, 72);
  assert.deepEqual(result.topPerformers.map(report => report.videoId), ['observed']);
});
