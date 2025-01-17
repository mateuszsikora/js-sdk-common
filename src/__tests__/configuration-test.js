import { sleepAsync, eventSink } from 'launchdarkly-js-test-helpers';

import * as configuration from '../configuration';
import { LDInvalidArgumentError } from '../errors';
import * as messages from '../messages';
import EventEmitter from '../EventEmitter';

import * as stubPlatform from './stubPlatform';

describe('configuration', () => {
  function errorListener() {
    const logger = stubPlatform.logger();
    const emitter = EventEmitter(logger);
    const errorQueue = eventSink(emitter, 'error');
    return {
      emitter,
      logger,
      expectNoErrors: async () => {
        await sleepAsync(0); // errors are dispatched on next tick
        expect(errorQueue.length()).toEqual(0);
        expect(logger.output.error).toEqual([]);
      },
      expectError: async message => {
        await sleepAsync(0);
        expect(errorQueue.length()).toEqual(1);
        if (message) {
          expect(await errorQueue.take()).toEqual(new LDInvalidArgumentError(message));
        } else {
          expect((await errorQueue.take()).constructor.prototype.name).toEqual('LaunchDarklyInvalidArgumentError');
        }
      },
      expectWarningOnly: async message => {
        await sleepAsync(0);
        expect(errorQueue.length()).toEqual(0);
        expect(logger.output.warn).toContain(message);
      },
    };
  }

  async function expectDefault(name) {
    const listener = errorListener();
    const config = configuration.validate({}, listener.emitter, null, listener.logger);
    expect(config[name]).toBe(configuration.baseOptionDefs[name].default);
    await listener.expectNoErrors();
  }

  function checkDeprecated(oldName, newName, value) {
    const desc = newName
      ? 'allows "' + oldName + '" as a deprecated equivalent to "' + newName + '"'
      : 'warns that "' + oldName + '" is deprecated';
    it(desc, async () => {
      const listener = errorListener();
      const config0 = {};
      config0[oldName] = value;
      const config1 = configuration.validate(config0, listener.emitter, null, listener.logger);
      if (newName) {
        expect(config1[newName]).toBe(value);
        expect(config1[oldName]).toBeUndefined();
      } else {
        expect(config1[oldName]).toEqual(value);
      }
      await listener.expectWarningOnly(messages.deprecated(oldName, newName));
    });
  }

  function checkBooleanProperty(name) {
    it('enforces boolean type and default for "' + name + '"', async () => {
      await expectDefault(name);

      let listener = errorListener();
      const configIn1 = {};
      configIn1[name] = true;
      const config1 = configuration.validate(configIn1, listener.emitter, null, listener.logger);
      expect(config1[name]).toBe(true);
      await listener.expectNoErrors();

      listener = errorListener();
      const configIn2 = {};
      configIn2[name] = false;
      const config2 = configuration.validate(configIn2, listener.emitter, null, listener.logger);
      expect(config2[name]).toBe(false);
      await listener.expectNoErrors();

      listener = errorListener();
      const configIn3 = {};
      configIn3[name] = 'abc';
      const config3 = configuration.validate(configIn3, listener.emitter, null, listener.logger);
      expect(config3[name]).toBe(true);
      await listener.expectError(messages.wrongOptionTypeBoolean(name, 'string'));

      listener = errorListener();
      const configIn4 = {};
      configIn4[name] = 0;
      const config4 = configuration.validate(configIn4, listener.emitter, null, listener.logger);
      expect(config4[name]).toBe(false);
      await listener.expectError(messages.wrongOptionTypeBoolean(name, 'number'));
    });
  }

  checkBooleanProperty('sendEvents');
  checkBooleanProperty('allAttributesPrivate');
  checkBooleanProperty('sendLDHeaders');
  checkBooleanProperty('inlineUsersInEvents');
  checkBooleanProperty('sendEventsOnlyForVariation');
  checkBooleanProperty('useReport');
  checkBooleanProperty('evaluationReasons');
  checkBooleanProperty('diagnosticOptOut');
  checkBooleanProperty('streaming');

  checkDeprecated('allowFrequentDuplicateEvents', undefined, true);

  function checkNumericProperty(name, validValue) {
    it('enforces numeric type and default for "' + name + '"', async () => {
      await expectDefault(name);

      let listener = errorListener();
      const configIn1 = {};
      configIn1[name] = validValue;
      const config1 = configuration.validate(configIn1, listener.emitter, null, listener.logger);
      expect(config1[name]).toBe(validValue);
      await listener.expectNoErrors();

      listener = errorListener();
      const configIn2 = {};
      configIn2[name] = 'no';
      const config2 = configuration.validate(configIn2, listener.emitter, null, listener.logger);
      expect(config2[name]).toBe(configuration.baseOptionDefs[name].default);
      await listener.expectError(messages.wrongOptionType(name, 'number', 'string'));
    });
  }

  checkNumericProperty('eventCapacity', 200);
  checkNumericProperty('flushInterval', 3000);
  checkNumericProperty('samplingInterval', 1);
  checkNumericProperty('streamReconnectDelay', 2000);

  function checkMinimumValue(name, minimum) {
    it('disallows value below minimum of ' + minimum + ' for ' + name, async () => {
      const listener = errorListener();
      const configIn = {};
      configIn[name] = minimum - 1;
      const config = configuration.validate(configIn, listener.emitter, null, listener.logger);
      await listener.expectError(messages.optionBelowMinimum(name, minimum - 1, minimum));
      expect(config[name]).toBe(minimum);
    });
  }

  checkMinimumValue('eventCapacity', 1);
  checkMinimumValue('flushInterval', 2000);
  checkMinimumValue('samplingInterval', 0);
  checkMinimumValue('diagnosticRecordingInterval', 2000);

  function checkValidValue(name, goodValue) {
    it('allows value of ' + JSON.stringify(goodValue) + ' for ' + name, async () => {
      const listener = errorListener();
      const configIn = {};
      configIn[name] = goodValue;
      const config = configuration.validate(configIn, listener.emitter, null, listener.logger);
      await listener.expectNoErrors();
      expect(config[name]).toBe(goodValue);
    });
  }

  checkValidValue('bootstrap', 'localstorage');
  checkValidValue('bootstrap', { flag: 'value' });

  it('validates custom logger methods', () => {
    const badLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: 'not a function' };
    const listener = errorListener();
    const configIn = { logger: badLogger };
    expect(() => configuration.validate(configIn, listener.emitter, null, listener.logger)).toThrow();
  });

  it('allows custom logger with valid methods', async () => {
    const goodLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const listener = errorListener();
    const configIn = { logger: goodLogger };
    const config = configuration.validate(configIn, listener.emitter, null, listener.logger);
    await listener.expectNoErrors();
    expect(config.logger).toBe(goodLogger);
  });

  it('complains if you set an unknown property', async () => {
    const listener = errorListener();
    const configIn = { unsupportedThing: true };
    const config = configuration.validate(configIn, listener.emitter, null, listener.logger);
    await listener.expectError(messages.unknownOption('unsupportedThing'));
    expect(config.unsupportedThing).toBe(true);
  });

  it('allows platform-specific SDK options whose defaults are specified by the SDK', async () => {
    const listener = errorListener();
    const fn = () => {};
    const platformSpecificOptions = {
      extraBooleanOption: { default: true },
      extraNumericOption: { default: 2 },
      extraNumericOptionWithoutDefault: { type: 'number' },
      extraStringOption: { default: 'yes' },
      extraStringOptionWithoutDefault: { type: 'string' },
      extraFunctionOption: { type: 'function' },
    };
    const configIn = {
      extraBooleanOption: false,
      extraNumericOptionWithoutDefault: 'not a number',
      extraStringOptionWithoutDefault: 'ok',
      extraFunctionOption: fn,
    };
    const config = configuration.validate(configIn, listener.emitter, platformSpecificOptions, listener.logger);
    expect(config.extraBooleanOption).toBe(false);
    expect(config.extraNumericOption).toBe(2);
    expect(config.extraStringOption).toBe('yes');
    expect(config.extraStringOptionWithoutDefault).toBe('ok');
    expect(config.extraFunctionOption).toBe(fn);
    await listener.expectError(messages.wrongOptionType('extraNumericOptionWithoutDefault', 'number', 'string'));
  });

  it('handles a valid application id', async () => {
    const listener = errorListener();
    const configIn = { application: { id: 'test-application' } };
    expect(configuration.validate(configIn, listener.emitter, null, listener.logger).application.id).toEqual(
      'test-application'
    );
  });

  it('logs a warning with an invalid application id', async () => {
    const listener = errorListener();
    const configIn = { application: { id: 'test #$#$#' } };
    expect(configuration.validate(configIn, listener.emitter, null, listener.logger).application.id).toBeUndefined();
    await listener.expectWarningOnly(messages.invalidTagValue('application.id'));
  });

  it('logs a warning when a tag value is too long', async () => {
    const listener = errorListener();
    const configIn = { application: { id: 'a'.repeat(65), version: 'b'.repeat(64) } };
    expect(configuration.validate(configIn, listener.emitter, null, listener.logger).application.id).toBeUndefined();
    await listener.expectWarningOnly(messages.tagValueTooLong('application.id'));
  });

  it('handles a valid application version', async () => {
    const listener = errorListener();
    const configIn = { application: { version: 'test-version' } };
    expect(configuration.validate(configIn, listener.emitter, null, listener.logger).application.version).toEqual(
      'test-version'
    );
  });

  it('logs a warning with an invalid application version', async () => {
    const listener = errorListener();
    const configIn = { application: { version: 'test #$#$#' } };
    expect(
      configuration.validate(configIn, listener.emitter, null, listener.logger).application.version
    ).toBeUndefined();
    await listener.expectWarningOnly(messages.invalidTagValue('application.version'));
  });

  it('includes application id and version in tags when present', async () => {
    expect(configuration.getTags({ application: { id: 'test-id', version: 'test-version' } })).toEqual({
      'application-id': ['test-id'],
      'application-version': ['test-version'],
    });
  });
});
