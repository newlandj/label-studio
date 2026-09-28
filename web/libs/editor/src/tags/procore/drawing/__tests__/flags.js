// Feature flags are read when @humansignal/core loads, so tests import this first.
window.APP_SETTINGS = {
  ...(window.APP_SETTINGS ?? {}),
  feature_flags: {
    ...(window.APP_SETTINGS?.feature_flags ?? {}),
    fflag_feat_front_bros_194_custom_tags_short: true,
  },
};
