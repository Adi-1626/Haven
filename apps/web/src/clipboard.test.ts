import test from 'node:test';
import assert from 'node:assert/strict';
import { writeTextToClipboard, copyWithFeedback } from './clipboard';

test('writeTextToClipboard returns false immediately for empty text', async () => {
  const result = await writeTextToClipboard('');
  assert.equal(result, false);
});

test('writeTextToClipboard prefers window.haven.writeClipboard IPC when available', async () => {
  let invokedWith = '';
  const originalHaven = (globalThis as any).window?.haven;
  (globalThis as any).window = {
    haven: {
      writeClipboard: async (text: string) => {
        invokedWith = text;
        return true;
      },
    },
  };

  try {
    const success = await writeTextToClipboard('hello from haven');
    assert.equal(success, true);
    assert.equal(invokedWith, 'hello from haven');
  } finally {
    if (originalHaven) {
      (globalThis as any).window.haven = originalHaven;
    } else {
      delete (globalThis as any).window;
    }
  }
});

test('writeTextToClipboard falls back to navigator.clipboard.writeText when haven is absent', async () => {
  let written = '';
  const originalDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      clipboard: {
        writeText: async (text: string) => {
          written = text;
        },
      },
    },
    configurable: true,
    writable: true,
  });

  try {
    const success = await writeTextToClipboard('testing web clipboard');
    assert.equal(success, true);
    assert.equal(written, 'testing web clipboard');
  } finally {
    if (originalDesc) {
      Object.defineProperty(globalThis, 'navigator', originalDesc);
    }
  }
});

test('writeTextToClipboard falls back to document.execCommand when navigator.clipboard throws', async () => {
  let commandRun = '';
  const originalNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalDoc = (globalThis as any).document;

  Object.defineProperty(globalThis, 'navigator', {
    value: {
      clipboard: {
        writeText: async () => {
          throw new Error('NotAllowedError: Clipboard access was denied');
        },
      },
    },
    configurable: true,
    writable: true,
  });

  (globalThis as any).document = {
    createElement: () => ({
      style: {},
      setAttribute: () => {},
      focus: () => {},
      select: () => {},
      setSelectionRange: () => {},
      value: '',
    }),
    body: {
      appendChild: () => {},
      removeChild: () => {},
    },
    execCommand: (command: string) => {
      commandRun = command;
      return true;
    },
  };

  try {
    const success = await writeTextToClipboard('fallback copy text');
    assert.equal(success, true);
    assert.equal(commandRun, 'copy');
  } finally {
    if (originalNavDesc) {
      Object.defineProperty(globalThis, 'navigator', originalNavDesc);
    }
    (globalThis as any).document = originalDoc;
  }
});

test('copyWithFeedback calls onSuccess and notification callback on success', async () => {
  (globalThis as any).window = {
    haven: {
      writeClipboard: async () => true,
    },
  };

  let notifiedMessage = '';
  let successTriggered = false;

  try {
    const ok = await copyWithFeedback(
      'code-12345',
      'Invite code',
      msg => {
        notifiedMessage = msg;
      },
      () => {
        successTriggered = true;
      }
    );

    assert.equal(ok, true);
    assert.equal(successTriggered, true);
    assert.equal(notifiedMessage, 'Invite code copied!');
  } finally {
    delete (globalThis as any).window;
  }
});

test('copyWithFeedback calls onError when all clipboard operations fail', async () => {
  (globalThis as any).window = {
    haven: {
      writeClipboard: async () => {
        throw new Error('IPC failed');
      },
    },
  };

  let errorMessage = '';
  try {
    const ok = await copyWithFeedback(
      'text',
      'Token',
      undefined,
      undefined,
      err => {
        errorMessage = err;
      }
    );

    assert.equal(ok, false);
    assert.ok(errorMessage.includes('Could not copy'));
  } finally {
    delete (globalThis as any).window;
  }
});
