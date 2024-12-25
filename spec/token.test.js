import { Process, load } from "ao-unittest";
import { join } from "path";
import assert from "assert";
import { test } from "node:test";

const [code] = load(".load " + join(process.cwd(), "process/main.lua"));
const p = await Process.create(undefined, code);

test("should respond with APUS Token", async () => {
  const result = await p.send(null, [{ name: "Action", value: "Info" }]);
  const tags = result.Messages[0].Tags;
  assert.equal(tags.find((v) => v.name === "Name").value, "Apus");
});
