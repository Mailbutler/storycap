export class ScreenshotTimeoutError extends Error {
  name = 'ScreenshotTimeoutError';

  constructor(msec: number, target: { kind?: string; story?: string }) {
    super();
    this.message = `Screenshot timeout exceeded. 'capture' function is not triggered in ${msec} ms. Target story: ${target.kind}/${target.story}`;
  }
}

export class InvalidCurrentStoryStateError extends Error {
  name = 'InvalidCurrentStoryStateError';

  constructor() {
    super();
    this.message = 'Fail to screenshot. The current story is not set.';
  }
}

export class StoryRenderError extends Error {
  name = 'StoryRenderError';

  constructor(stories: { kind: string; story: string; message: string }[]) {
    super();
    this.message = `${stories.length} ${stories.length === 1 ? 'story' : 'stories'} failed to render:\n${stories
      .map(({ kind, story, message }) => `  - ${kind}/${story}: ${message}`)
      .join('\n')}`;
  }
}

export class RemoteRequestError extends Error {
  name = 'RemoteRequestError';

  constructor(urlsByStory: Map<string, Set<string>>) {
    super();
    this.message = `${urlsByStory.size} ${urlsByStory.size === 1 ? 'story' : 'stories'} requested remote URLs without fixture:\n${[
      ...urlsByStory,
    ]
      .map(([name, urls]) => `  - ${name}: ${[...urls].join(', ')}`)
      .join('\n')}`;
  }
}
