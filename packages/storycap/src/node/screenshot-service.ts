import { Story, createExecutionService, time } from '@prantlf/storycrawler';
import { CapturingBrowser } from './capturing-browser.js';
import { FileSystem } from './file.js';
import { Logger } from './logger.js';
import { VariantKey } from '../shared/types.js';
import { StoryRenderError } from './errors.js';

function createRequest({
  story,
  variantKey = { isDefault: true, keys: [] },
  count = 0,
}: {
  story: Story;
  variantKey?: VariantKey;
  count?: number;
}) {
  let rid;
  const base = encodeURIComponent(story.id);
  if (variantKey && variantKey.keys.length) {
    rid = `${base}?keys=${encodeURIComponent(variantKey.keys.join(','))}`;
  } else {
    rid = base;
  }
  return { rid, story, variantKey, count };
}

/**
 *
 * Executor to capture all stories.
 *
 **/
export interface ScreenshotService {
  /**
   *
   * Run capturing procedure.
   *
   * @returns The number of captured images
   **/
  execute(): Promise<number>;
}

/**
 *
 * Parameters for {@link createScreenshotService}.
 *
 **/
export type ScreenshotServiceOptions = {
  logger: Logger;
  workers: CapturingBrowser[];
  fileSystem: FileSystem;
  stories: Story[];
  forwardConsoleLogs: boolean;
  trace: boolean;
  failOnStoryError: boolean;
};

/**
 *
 * Create an instance of {@link ScreenshotService}.
 *
 * @param options - {@link ScreenshotServiceOptions}
 * @returns A `ScreenshotService` instance
 *
 **/
export function createScreenshotService({
  fileSystem,
  logger,
  stories,
  workers,
  forwardConsoleLogs,
  trace,
  failOnStoryError,
}: ScreenshotServiceOptions): ScreenshotService {
  const brokenStories: { kind: string; story: string; message: string }[] = [];
  const service = createExecutionService(
    workers,
    stories.map(story => createRequest({ story })),
    ({ rid, story, variantKey, count }, { push }) =>
      async worker => {
        // Delegate the request to the worker.
        const [result, elapsedTime] = await time(
          worker.screenshot(rid, story, variantKey, count, logger, forwardConsoleLogs, trace, fileSystem),
        );

        const { succeeded, buffer, variantKeysToPush, defaultVariantSuffix, storyError } = result;

        // Queue retry request if the request was not succeeded.
        // Worker throws `ScreenshotTimeoutError` if the queued request continues failed and the count exceeds the threhold.
        if (!succeeded) return push(createRequest({ story, variantKey, count: count + 1 }));

        if (storyError) {
          const name = `${story.kind}/${story.story}`;
          if (failOnStoryError) {
            brokenStories.push({ kind: story.kind, story: story.story, message: storyError.message });
            logger.error(`Story ${logger.color.yellow(name)} failed to render: ${storyError.message}`);
            if (storyError.stack) logger.errorStack(storyError.stack);
          } else {
            logger.warn(`Story ${logger.color.yellow(name)} failed to render: ${storyError.message}`);
          }
        }

        // Queue screenshot requests for additional variants.
        variantKeysToPush.forEach(variantKey => push(createRequest({ story, variantKey })));

        if (buffer) {
          const suffix = variantKey.isDefault && defaultVariantSuffix ? [defaultVariantSuffix] : variantKey.keys;
          const path = await fileSystem.saveScreenshot(story.kind, story.story, suffix, buffer);
          logger.log(`Screenshot stored: ${logger.color.magenta(path)} in ${elapsedTime} msec.`);
          return true;
        }
      },
  );
  return {
    execute: async () => {
      const captured = await service.execute();
      if (brokenStories.length) throw new StoryRenderError(brokenStories);
      return captured.filter(c => !!c).length;
    },
  };
}
