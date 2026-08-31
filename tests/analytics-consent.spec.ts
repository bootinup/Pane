import { test, expect } from '@playwright/test';
import type { JsonObject } from '../shared/validation/boundaryDecoder';
import { installElectronApiMock } from './electronApiMock';

type CapturedPostHogRequest = {
  url: string;
  body: string;
};

type CapturedPostHogEvent = {
  event?: string;
  properties?: JsonObject;
};

function parseCapturedEvents(requests: CapturedPostHogRequest[]): CapturedPostHogEvent[] {
  return requests.flatMap((request) => {
    try {
      const body = parsePostHogBody(request.body);
      if (Array.isArray(body.batch)) {
        return body.batch;
      }
      return [body];
    } catch {
      return [];
    }
  });
}

function parsePostHogBody(bodyText: string): CapturedPostHogEvent & { batch?: CapturedPostHogEvent[] } {
  try {
    // SAFETY: captured PostHog requests are decoded into the fixture's constrained event shape.
    return JSON.parse(bodyText) as CapturedPostHogEvent & { batch?: CapturedPostHogEvent[] };
  } catch {
    const data = new URLSearchParams(bodyText).get('data');
    // SAFETY: captured PostHog requests are decoded into the fixture's constrained event shape.
    return data
      ? JSON.parse(data) as CapturedPostHogEvent & { batch?: CapturedPostHogEvent[] }
      : {};
  }
}

test('undecided installs default on, disclose analytics, and can opt out in one click', async ({ page }) => {
  const identity = {
    distinctId: 'install:install_default_e2e',
    installId: 'install_default_e2e',
    identitySource: 'anonymous',
    appVersion: '2.1.2-test',
    platform: 'linux',
    electronVersion: 'test-electron',
    webDistinctId: 'web_default_e2e',
    webAttributionPresent: true,
    isFirstLaunch: true,
    previousVersion: null,
  };
  const requests: CapturedPostHogRequest[] = [];

  await page.route('http://posthog.test/**', async (route) => {
    requests.push({
      url: route.request().url(),
      body: route.request().postData() ?? '',
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    });
  });

  await installElectronApiMock(page, {
    analyticsConsentShown: false,
    initialPreferences: { analytics_default_notice_shown: 'false' },
    analyticsIdentity: identity,
    initialConfig: {
      analytics: {
        enabled: false,
        posthogApiKey: 'phc_test',
        posthogHost: 'http://posthog.test',
        installId: identity.installId,
        distinctId: identity.distinctId,
        identitySource: identity.identitySource,
      },
    },
    mainAnalyticsEvents: [
      {
        eventName: 'app_opened',
        properties: { is_first_launch: true },
      },
    ],
  });

  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  await expect(page.getByRole('complementary', { name: 'Analytics notice' })).toBeVisible({ timeout: 10000 });
  await expect.poll(() => parseCapturedEvents(requests).map((event) => event.event)).toEqual(
    expect.arrayContaining(['analytics_notice_shown', 'analytics_default_enabled', 'app_first_opened'])
  );

  await page.getByRole('button', { name: 'Turn off analytics' }).click();

  await expect.poll(() => parseCapturedEvents(requests).map((event) => event.event)).toEqual(
    expect.arrayContaining(['analytics_notice_shown', 'analytics_default_enabled', 'app_first_opened', 'analytics_opted_out'])
  );
  await expect(page.getByRole('complementary', { name: 'Analytics notice' })).toBeHidden();

  const events = parseCapturedEvents(requests);
  const noticeShown = events.find((event) => event.event === 'analytics_notice_shown');
  const defaultEnabled = events.find((event) => event.event === 'analytics_default_enabled');
  const firstOpened = events.find((event) => event.event === 'app_first_opened');
  const optedOut = events.find((event) => event.event === 'analytics_opted_out');

  for (const event of [noticeShown, defaultEnabled, firstOpened, optedOut]) {
    expect(event?.properties).toMatchObject({
      distinct_id: identity.distinctId,
      install_id: identity.installId,
      identity_source: identity.identitySource,
      app_version: identity.appVersion,
      platform: identity.platform,
    });
    expect(event?.properties?.$set).toMatchObject({
      install_id: identity.installId,
      app_version: identity.appVersion,
      platform: identity.platform,
    });
  }

  expect(firstOpened?.properties).toMatchObject({
    source: 'web_attribution',
    web_attributed: true,
    web_attribution_present: true,
    is_first_launch: true,
  });
  expect(optedOut?.properties).toMatchObject({ source: 'default_on_notice' });
});

test('an explicit existing opt-out stays disabled and receives no default-on notice', async ({ page }) => {
  const identity = {
    distinctId: 'install:install_existing_opt_out_e2e',
    installId: 'install_existing_opt_out_e2e',
    identitySource: 'anonymous',
    appVersion: '2.1.2-test',
    platform: 'linux',
    electronVersion: 'test-electron',
    webAttributionPresent: false,
    isFirstLaunch: false,
    previousVersion: '2.1.1-test',
  };
  const requests: CapturedPostHogRequest[] = [];

  await page.route('http://posthog.test/**', async (route) => {
    requests.push({
      url: route.request().url(),
      body: route.request().postData() ?? '',
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    });
  });

  await installElectronApiMock(page, {
    analyticsConsentShown: true,
    analyticsIdentity: identity,
    initialConfig: {
      analytics: {
        enabled: false,
        posthogApiKey: 'phc_test',
        posthogHost: 'http://posthog.test',
        installId: identity.installId,
        distinctId: identity.distinctId,
        identitySource: identity.identitySource,
      },
    },
    mainAnalyticsEvents: [
      {
        eventName: 'app_opened',
        properties: { is_first_launch: false },
      },
    ],
  });

  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  await expect(page.getByRole('complementary', { name: 'Analytics notice' })).toBeHidden();
  await page.waitForTimeout(250);
  expect(parseCapturedEvents(requests).map((event) => event.event)).not.toEqual(
    expect.arrayContaining(['analytics_notice_shown', 'analytics_default_enabled', 'app_opened'])
  );
});
