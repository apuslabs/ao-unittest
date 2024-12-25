#!/usr/bin/env node

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { spawn } from "child_process";
const args = process.argv.slice(2);

import { Command } from "commander";
const program = new Command();
program.name("ao-unittest").description("AO Unit Test").version("0.0.1");

import fs from "fs-extra";
import { join, isAbsolute, dirname } from "path";
import { fileURLToPath } from "url";
import load from "./load.js";
import { BUILD_FOLDER } from "./config.js";
import { Process } from "./aoloader.js";

export function isDirectory(path) {
  try {
    const stats = fs.statSync(path);
    return stats.isDirectory();
  } catch (error) {
    console.error(`Error checking if path is a directory: ${error.message}`);
    return false;
  }
}

function absolutePath(path) {
  return isAbsolute(path) ? path : join(process.cwd(), path);
}

program
  .option(
    "--src <src>",
    "Specify process path, default: ./process",
    function (v) {
      if (!isDirectory(v)) {
        throw new Error("Path is not a directory");
      }
      return absolutePath(v);
    },
    "./process"
  )
  .option(
    "--spec <path>",
    "Specify spec path, default: ./spec",
    function (v) {
      if (!isDirectory(v)) {
        throw new Error("Path is not a directory");
      }
      return absolutePath(v);
    },
    "./spec"
  )
  .option("--pid <pid>", "Specify process id, default: 1", "1")
  .option("--from <from>", "Specify process owner, default: FOOBAR", "FOOBAR")
  .option("--module <moduleid>", "Specify module id, default: AOS", "");

program.command("unit [testFile]").action((testFile) => {
  const { src, spec } = program.opts();
  copyFiles(src, spec);
  if (!testFile) {
    const specs = scanSpec(spec);
    for (const file of specs) {
      console.group(`Running ${file}`);
      runTestfile(join(BUILD_FOLDER, file));
      console.groupEnd();
    }
  } else {
    runTestfile(join(BUILD_FOLDER, testFile));
  }
});

if (!process.execArgv.includes("--experimental-wasm-memory64")) {
  const child = spawn(
    process.execPath,
    ["--experimental-wasm-memory64", __filename, ...args],
    {
      stdio: "inherit",
      env: process.env,
    }
  );
  child.on("exit", (code) => {
    process.exit(code);
  });
} else {
  prepareBuildFolder();
  program.parse(process.argv);
}

function scanSpec(folder) {
  const files = fs.readdirSync(folder);
  const luaFiles = files.filter((f) => f.endsWith("_spec.lua"));
  return luaFiles;
}

async function runTestfile(path) {
  const [line] = load(importLua(path));
  const options = program.opts();
  const process = await Process.create(options.module, line, {
    Id: options.pid,
  });
  if (process.result.Error) {
    console.error(process.result.Error);
  } else {
    console.log(process.result?.Output?.data);
  }
}

function prepareBuildFolder() {
  fs.ensureDirSync(BUILD_FOLDER);
  fs.emptyDirSync(BUILD_FOLDER);
  fs.ensureDirSync(join(BUILD_FOLDER, "module"));
  fs.copySync(join(__dirname, "libs"), join(BUILD_FOLDER, "libs"));
}

function copyFiles(src, dest) {
  fs.copySync(src, BUILD_FOLDER);
  fs.readdirSync(dest).forEach((file) => {
    if (file !== BUILD_FOLDER) {
      fs.copySync(join(dest, file), join(BUILD_FOLDER, file));
    }
  });
}

function importLua(file) {
  return ".load " + file;
}
