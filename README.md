# AO Unit Test Framework

## Introduction

The AO Unit Test Framework is a tool designed for running Lua unit tests. It leverages the capabilities of WebAssembly and JavaScript to execute tests, supporting flexible directory structures and configuration options.

## Features

- Run all test files or a specified single test file.
- Automatically create and manage a build folder.
- Support for custom source and spec paths.
- Load and execute Lua scripts using WebAssembly.

## Installation

Make sure you have Node.js and npm installed. Then, you can install the project dependencies using the following command:

```bash
npm install
npm link
```

## Usage

_Command Line Options_
The framework provides the following command-line options:

- `--src <src>`: Specify the process path, default is ./process.
- `--spec <path>`: Specify the spec path, default is ./spec.
- `--pid <pid>`: Specify the process ID, default is 1.
- `--from <from>`: Specify the process owner, default is FOOBAR.

### Running Tests

To run all test files, use the following command:

```bash
# run all test file in ./spec with _spec.lua suffix
ao-unittest unit
# run specific test file
ao-unittest unit example_spec.lua
```

## Roadmap

- Rollup package
- Support weavedrive
