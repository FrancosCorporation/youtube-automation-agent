'use strict';

const policy = require('../config/social-publishing.json');
const ENABLED_SOCIAL_PLATFORMS = Object.freeze([...policy.enabledPlatforms]);
const EXCLUDED_SOCIAL_PLATFORMS = Object.freeze([...policy.excludedPlatforms]);

module.exports = { ENABLED_SOCIAL_PLATFORMS, EXCLUDED_SOCIAL_PLATFORMS };
