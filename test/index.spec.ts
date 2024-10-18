import fs from 'fs';
import dotenv from 'dotenv';
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { validateEnv } from '../src/index';


jest.mock('fs');
jest.mock('dotenv');

describe('validateEnv', () => {
  const mockExit = jest.spyOn(process, 'exit').mockImplementation((code?: number | string | null | undefined) => { throw new Error(`Process exit with code ${code}`); });
  const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => { });
  const mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => { });

  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (dotenv.config as jest.Mock).mockReturnValue({ parsed: {} });
  });

  it('should validate and return correct environment variables', () => {
    (dotenv.config as jest.Mock).mockReturnValue({
      parsed: {
        PORT: '3000',
        HOST: 'localhost',
        DEBUG: 'true',
      },
    });

    const schema = {
      PORT: Number,
      HOST: String,
      DEBUG: Boolean,
    };

    const result = validateEnv(schema);

    expect(result).toEqual({
      PORT: 3000,
      HOST: 'localhost',
      DEBUG: true,
    });
  });

  it('should use default values when provided and env variable is missing', () => {
    (dotenv.config as jest.Mock).mockReturnValue({
      parsed: {
        PORT: '3000',
      },
    });

    const schema = {
      PORT: Number,
      HOST: { type: String, default: 'localhost', required: false },
      DEBUG: { type: Boolean, default: false, required: false },
    };

    const result = validateEnv(schema);

    expect(result).toEqual({
      PORT: 3000,
      HOST: 'localhost',
      DEBUG: false,
    });
  });

  it('should throw an error when required field is missing', () => {
    (dotenv.config as jest.Mock).mockReturnValue({
      parsed: {},
    });

    const schema = {
      PORT: Number,
    };

    expect(() => validateEnv(schema)).toThrow('Process exit with code 1');
    expect(mockConsoleError).toHaveBeenCalledWith('Environment validation failed:');
    expect(mockConsoleError).toHaveBeenCalledWith('- Missing required field: PORT');
  });

  it('should throw an error when field type is invalid', () => {
    (dotenv.config as jest.Mock).mockReturnValue({
      parsed: {
        PORT: 'not-number',
        DEBUG: 'not-boolean',
      },
    });

    const schema = {
      PORT: Number,
      DEBUG: Boolean,
    };

    expect(() => validateEnv(schema)).toThrow('Process exit with code 1');
    expect(mockConsoleError).toHaveBeenCalledWith('Environment validation failed:');
    expect(mockConsoleError).toHaveBeenCalledWith('- PORT should be a number');
    expect(mockConsoleError).toHaveBeenCalledWith('- DEBUG should be a boolean');
  });

  it('should throw an error when .env file is not found', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const schema = {
      PORT: Number,
    };

    expect(() => validateEnv(schema)).toThrow('Process exit with code 1');
    expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Environment file not found:'));
  });

  it('should throw an error when dotenv fails to parse .env file', () => {
    (dotenv.config as jest.Mock).mockReturnValue({
      error: new Error('Failed to parse'),
    });

    const schema = {
      PORT: Number,
    };

    expect(() => validateEnv(schema)).toThrow('Process exit with code 1');
    expect(mockConsoleError).toHaveBeenCalledWith('Failed to load .env file: Failed to parse');
  });

  it('should use process.env when dotenv is not available', () => {
    (dotenv.config as jest.Mock).mockImplementation(() => {
      throw new Error('dotenv not available');
    });

    process.env.PORT = '3000';

    const schema = {
      PORT: Number,
    };

    const result = validateEnv(schema);

    expect(result).toEqual({
      PORT: 3000,
    });
    expect(mockConsoleWarn).toHaveBeenCalledWith('dotenv is not installed or not configured correctly. Using process.env directly.');
  });

  it('should throw an error for unsupported types', () => {
    (dotenv.config as jest.Mock).mockReturnValue({
      parsed: {
        UNSUPPORTED: 'value',
      },
    });

    const schema = {
      UNSUPPORTED: Date as any,
    };

    expect(() => validateEnv(schema)).toThrow('Process exit with code 1');
    expect(mockConsoleError).toHaveBeenCalledWith('Environment validation failed:');
    expect(mockConsoleError).toHaveBeenCalledWith('- UNSUPPORTED has an unsupported type');
  });

  it('should allow specifying a custom .env file', () => {
    (dotenv.config as jest.Mock).mockReturnValue({
      parsed: {
        PORT: '3000',
      },
    });

    const schema = {
      PORT: Number,
    };

    validateEnv(schema, '.env.test');

    expect(dotenv.config).toHaveBeenCalledWith(expect.objectContaining({
      path: expect.stringContaining('.env.test'),
    }));
  });
});
