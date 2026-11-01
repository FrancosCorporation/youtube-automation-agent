const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'dashboard/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'dashboard/app.js'), 'utf8');
const enhance = fs.readFileSync(path.join(root, 'dashboard/enhance.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'dashboard/styles.css'), 'utf8');

test('dashboard provides a keyboard skip link and a visible focus destination', () => {
  assert.match(html, /<a class="skip-link" href="#main-content">/);
  assert.match(html, /<main id="main-content" tabindex="-1" aria-busy="false">/);
  assert.match(html, /<h1 id="view-title" tabindex="-1">/);
  assert.match(styles, /\.skip-link:focus\s*\{[^}]*transform:\s*translateY\(0\)/);
  assert.match(styles, /#main-content:focus, #view-title:focus\s*\{[^}]*outline:\s*2px solid/);
});

test('view changes expose the current navigation item and support browser history', () => {
  assert.match(html, /data-view="overview" aria-current="page"/);
  assert.match(app, /item\.setAttribute\('aria-current', 'page'\)/);
  assert.match(app, /item\.removeAttribute\('aria-current'\)/);
  assert.match(app, /if \(focus\) \$\('#view-title'\)\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /window\.addEventListener\('hashchange'/);
  assert.match(app, /location\.hash\.slice\(1\) \|\| 'overview'/);
  assert.match(app, /updateHash: false/);
  assert.match(app, /if \(updateHash && location\.hash\.slice\(1\) !== view\) location\.hash = view/);
  assert.match(enhance, /window\.switchView = function \(view, options\)/);
});

test('command palette modal keeps focus, restores it, and exposes active list options', () => {
  assert.match(enhance, /role="dialog" aria-modal="true" aria-labelledby="cmdk-dialog-title"/);
  assert.match(enhance, /role="combobox"[^>]*aria-haspopup="listbox"[^>]*aria-controls="cmdk-list"/);
  assert.match(enhance, /event\.key === 'Tab'\) \{ event\.preventDefault\(\); return inputEl\.focus\(\); \}/);
  assert.match(enhance, /shell\.inert = true/);
  assert.match(enhance, /previousFocus\.focus\(\)/);
  assert.match(enhance, /aria-activedescendant/);
  assert.match(enhance, /inputEl\.setAttribute\('aria-expanded', 'false'\)/);
  assert.match(enhance, /role="status" aria-live="polite"/);
});

test('dashboard dialogs have accessible names and icon-only close controls are labeled', () => {
  assert.match(html, /<dialog id="generate-dialog"[^>]*aria-labelledby="generate-dialog-title"/);
  assert.match(html, /<h2 id="generate-dialog-title">Create a video<\/h2>/);
  assert.match(html, /<dialog id="idea-dialog"[^>]*aria-labelledby="idea-dialog-title"/);
  assert.match(html, /<h2 id="idea-dialog-title">Add a content idea<\/h2>/);
  assert.match(html, /<dialog id="content-dialog"[^>]*aria-labelledby="content-dialog-title"/);
  assert.match(app, /<h2 id="content-dialog-title">\$\{escapeHTML\(title\)\}<\/h2>/);
  assert.match(html, /data-close aria-label="Close create video dialog"/);
  assert.match(html, /data-close aria-label="Close add idea dialog"/);
  assert.match(app, /data-close aria-label="Close content review"/);
});

test('command palette includes every dashboard view and status messages announce errors assertively', () => {
  for (const view of ['overview', 'operator', 'knowledge', 'pipeline', 'calendar', 'analytics', 'engagement', 'readiness', 'settings']) {
    assert.match(enhance, new RegExp(`${view}: \\[`), `${view} is present in the command palette`);
  }
  assert.match(html, /id="toast"[^>]*aria-live="polite"/);
  assert.match(app, /type === 'error' \? 'alert' : 'status'/);
  assert.match(app, /type === 'error' \? 'assertive' : 'polite'/);
});

test('agent knowledge view exposes a multi-file drag-and-drop upload area', () => {
  assert.match(html, /data-view="knowledge"/);
  assert.match(html, /id="knowledge-view" class="view"/);
  assert.match(html, /id="knowledge-dropzone" class="knowledge-dropzone"/);
  assert.match(html, /id="knowledge-files"[^>]*type="file" multiple aria-label="Choose reference documents to upload"/);
  assert.match(html, /Drag and drop documents here/);
  assert.match(html, /\.pdf,\.docx,\.txt,\.md,\.csv,\.json/);
  assert.match(app, /event\.dataTransfer\?\.files/);
  assert.match(app, /api\('\/api\/knowledge-base\/documents'/);
});

test('enhanced toast preserves live announcements after replacing its markup', () => {
  assert.match(enhance, /const toastType = \['error', 'warning', 'success'\]\.includes\(type\) \? type : 'success'/);
  assert.match(enhance, /toast\.setAttribute\('role', toastType === 'error' \? 'alert' : 'status'\)/);
  assert.match(enhance, /toast\.setAttribute\('aria-live', toastType === 'error' \? 'assertive' : 'polite'\)/);
  assert.match(enhance, /toast\.setAttribute\('aria-atomic', 'true'\)/);
  assert.match(enhance, /class="toast-icon \$\{toastType\}" aria-hidden="true"/);
});

test('small dashboard helper text meets normal-text contrast against its surfaces', () => {
  const token = name => {
    const value = styles.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
    assert.ok(value, `missing --${name} color token`);
    return value;
  };
  const luminance = hex => hex.match(/[0-9a-f]{2}/gi)
    .map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = (foreground, background) => {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };

  const muted = token('muted');
  assert.match(styles, /input::placeholder, textarea::placeholder \{ color: var\(--muted\); \}/);
  assert.match(styles, /\.console-version \{ color: var\(--muted\);/);
  assert.ok(contrast(muted, token('bg')) >= 4.5, 'helper text must contrast against the page background');
  assert.ok(contrast(muted, token('surface-inset')) >= 4.5, 'helper text must reach 4.5:1 contrast');
});

test('dashboard loading state is announced and marks the main content busy only for active work', () => {
  assert.match(html, /<div id="loading" class="loading-bar" role="status" aria-live="polite" aria-atomic="true"><span class="sr-only"><\/span><\/div>/);
  assert.match(app, /function startLoading\(message\)/);
  assert.match(app, /activeLoadingTasks\.set\(id, String\(message \|\| 'Loading dashboard data'\)\)/);
  assert.match(app, /announcement\.textContent = messages\.at\(-1\) \|\| ''/);
  assert.match(app, /setAttribute\('aria-busy', String\(messages\.length > 0\)\)/);
  assert.match(app, /const stopLoading = silent \? null : startLoading\('Refreshing dashboard data'\)/);
  assert.match(app, /stopLoading\?\.\(\)/);
});
