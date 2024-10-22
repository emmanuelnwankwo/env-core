import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { jest, describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import { validateEnv } from '../src/index';


jest.mock('fs');
jest.mock('dotenv');
jest.mock('path', () => ({
  resolve: jest.fn()
}));

describe('validateEnv', () => {
  const originalEnv: NodeJS.ProcessEnv = process.env;
  const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => { });
  
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv }; // Reset environment
    process.exit = jest.fn() as any;
  });

  afterAll(() => {
    process.env = originalEnv; // Restore original environment
  });

  it('should load variables from .env file when present', () => {
    const mockEnvPath = '/test/path/.env';
    (path.resolve as jest.Mock).mockReturnValue(mockEnvPath);
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (dotenv.config as jest.Mock).mockReturnValue({
      parsed: { PORT: '3000', NODE_ENV: 'production' },
    });

    const schema = { PORT: Number, NODE_ENV: String };
    const result = validateEnv(schema);

    expect(result).toEqual({ PORT: 3000, NODE_ENV: 'production' });
    expect(dotenv.config).toHaveBeenCalledWith({ path: mockEnvPath });
  });

  it('should throw an error if dotenv.config fails to load .env file and continue with process.env', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (dotenv.config as jest.Mock).mockReturnValue({ error: new Error('Mocked dotenv error') });
    const mockEnvFile = 'test.env';

    const schema = { PORT: Number };

    validateEnv(schema, mockEnvFile);

    expect(mockConsoleError).toHaveBeenCalledWith(`Error loading ${mockEnvFile}: Mocked dotenv error`);
    expect(mockConsoleError).toHaveBeenCalledWith('Environment validation failed:');
  });

  it('should use process.env if .env file is missing and return correct environment variables', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    process.env.PORT = '4000';
    process.env.NODE_ENV = 'development';

    const schema = { PORT: Number, NODE_ENV: String };
    const result = validateEnv(schema);

    expect(result).toEqual({ PORT: 4000, NODE_ENV: 'development' });
  });

  it('should validate required fields and exit process if missing', () => {
    const mockEnvPath = '/test/path/.env';
    (path.resolve as jest.Mock).mockReturnValue(mockEnvPath);
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (dotenv.config as jest.Mock).mockReturnValue({ parsed: {} });
    process.env = {};

    const schema = { PORT: Number, NODE_ENV: String };

    validateEnv(schema);

    expect(mockConsoleError).toHaveBeenCalledWith('Environment validation failed:');
    expect(mockConsoleError).toHaveBeenCalledWith('- Missing required field: PORT');
    expect(mockConsoleError).toHaveBeenCalledWith('- Missing required field: NODE_ENV');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should use default values if available when environment variable is missing', () => {
    const schema = {
      PORT: { type: Number, required: false, default: 8080 },
      NODE_ENV: String,
      DEBUG: { type: Boolean, required: false, default: false },
    };

    process.env.NODE_ENV = 'production';

    const result = validateEnv(schema);

    expect(result).toEqual({ PORT: 8080, NODE_ENV: 'production', DEBUG: false });
  });

  it('should throw an error for invalid number type', () => {
    process.env.PORT = 'invalid_number';
    process.env.NODE_ENV = 'production';

    const schema = { PORT: Number, NODE_ENV: String };

    validateEnv(schema);

    expect(console.error).toHaveBeenCalledWith('Environment validation failed:');
    expect(console.error).toHaveBeenCalledWith('- PORT should be a number');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should validate boolean environment variables correctly', () => {
    process.env.DEBUG = 'true';
    process.env.NODE_ENV = 'development';

    const schema = { DEBUG: Boolean, NODE_ENV: String };
    const result = validateEnv(schema);

    expect(result).toEqual({ DEBUG: true, NODE_ENV: 'development' });
  });

  it('should throw an error for invalid boolean type', () => {
    process.env.DEBUG = 'not_a_boolean';
    process.env.NODE_ENV = 'development';

    const schema = { DEBUG: Boolean, NODE_ENV: String };

    validateEnv(schema);

    expect(mockConsoleError).toHaveBeenCalledWith('Environment validation failed:');
    expect(mockConsoleError).toHaveBeenCalledWith('- DEBUG should be a boolean');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should handle missing env file and fall back to process.env without error', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    process.env.PORT = '3000';
    process.env.NODE_ENV = 'production';

    const schema = { PORT: Number, NODE_ENV: String };
    const result = validateEnv(schema, undefined);

    expect(result).toEqual({ PORT: 3000, NODE_ENV: 'production' });
  });

  it('should throw an error for unsupported types', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    process.env.UNSUPPORTED = 'any';

    const schema = {
      UNSUPPORTED: Date as any,
    };
    validateEnv(schema);

    expect(mockConsoleError).toHaveBeenCalledWith('Environment validation failed:');
    expect(mockConsoleError).toHaveBeenCalledWith('- UNSUPPORTED has an unsupported type');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
