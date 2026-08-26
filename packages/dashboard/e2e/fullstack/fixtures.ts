import { type APIRequestContext, test as base, expect } from "@playwright/test";

interface EphemeralTestStack {
  serverUrl: string;
  teardown: () => Promise<void>;
}

interface TestStackModule {
  startEphemeralTestStack: () => Promise<EphemeralTestStack>;
}

const testStackModulePath = "../../../../test/helpers/test-stack.mts";

function isEphemeralTestStack(value: unknown): value is EphemeralTestStack {
  return (
    typeof value === "object" &&
    value !== null &&
    "serverUrl" in value &&
    typeof value.serverUrl === "string" &&
    "teardown" in value &&
    typeof value.teardown === "function"
  );
}

function isTestStackModule(value: unknown): value is TestStackModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "startEphemeralTestStack" in value &&
    typeof value.startEphemeralTestStack === "function"
  );
}

interface FullStackFixtures {
  request: APIRequestContext;
  stack: EphemeralTestStack;
}

export const test = base.extend<FullStackFixtures>({
  stack: async ({ browserName: _browserName }, use) => {
    const testStackModule: unknown = await import(testStackModulePath);
    if (!isTestStackModule(testStackModule)) {
      throw new Error("Ephemeral test stack module has an invalid shape");
    }
    const stack: unknown = await testStackModule.startEphemeralTestStack();
    if (!isEphemeralTestStack(stack)) {
      throw new Error("Ephemeral test stack has an invalid shape");
    }
    try {
      await use(stack);
    } finally {
      await stack.teardown();
    }
  },
  request: async ({ playwright, stack }, use) => {
    const request = await playwright.request.newContext({ baseURL: stack.serverUrl });
    try {
      await use(request);
    } finally {
      await request.dispose();
    }
  },
  page: async ({ browser, contextOptions, stack }, use) => {
    const context = await browser.newContext(contextOptions);
    await context.route("**/api/**", async (route) => {
      const source = new URL(route.request().url());
      const target = new URL(`${source.pathname}${source.search}`, stack.serverUrl);
      const response = await route.fetch({ url: target.href });
      await route.fulfill({ response });
    });
    const page = await context.newPage();
    try {
      await use(page);
    } finally {
      await context.close();
    }
  },
});

export { expect };
