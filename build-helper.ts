import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// File paths for CommonJS and ESM outputs
const CJS_FILE_PATH = resolve(__dirname, './dist/index.cjs');
const MJS_FILE_PATH = resolve(__dirname, './dist/index.mjs');

/**
 * Reads a file's content.
 * @param filePath - The path to the file to be read.
 * @returns The content of the file as a string.
 */
const readFileContent = (filePath: string): string => {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Error reading file at ${filePath}: ${(error as Error).message}`);
  }
};

/**
 * Writes content to a file.
 * @param filePath - The path to the file to be written.
 * @param content - The content to write into the file.
 */
const writeFileContent = (filePath: string, content: string): void => {
  try {
    writeFileSync(filePath, content, 'utf8');
  } catch (error) {
    throw new Error(`Error writing to file at ${filePath}: ${(error as Error).message}`);
  }
};

/**
 * Updates the export syntax in a CommonJS file.
 * Replaces `export { ... }` with `module.exports = { ... }`.
 * @param filePath - The path to the CommonJS file.
 */
const updateCjsExport = (filePath: string): void => {
  const content = readFileContent(filePath);

  if (content.includes('export {')) {
    const updatedContent = content.replace('export {', 'module.exports = {');
    writeFileContent(filePath, updatedContent);
    console.log(`CommonJS exports fixed in ${filePath}`);
  } else {
    console.warn(`No "export {" found in ${filePath}; skipping modification.`);
  }
};

/**
 * Verifies that the ES Module file uses proper export syntax.
 * Throws an error if the expected syntax is not found.
 * @param filePath - The path to the ES module file.
 */
const verifyMjsExport = (filePath: string): void => {
  const content = readFileContent(filePath);

  if (content.includes('export {')) {
    console.log(`ESM exports verified in ${filePath}`);
  } else {
    throw new Error(`Expected "export {" in ${filePath}, but it was not found.`);
  }
};

/**
 * Executes the export modifications for both CommonJS and ES Module files.
 */
const fixExports = (): void => {
  try {
    updateCjsExport(CJS_FILE_PATH);
    verifyMjsExport(MJS_FILE_PATH);
    console.log('Export fixes completed successfully.');
  } catch (error) {
    console.error(`Error during export fix process: ${(error as Error).message}`);
  }
};

// Run the export fix process
fixExports();
