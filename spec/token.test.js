import { Process, load } from "ao-unittest";
import { join } from "path";
import assert from "assert";
import { test } from "node:test";

const p = await Process.create(
  undefined,
  load(".load " + join(process.cwd(), "process/main.lua"))
);

// test("should respond with APUS Token", async () => {
//   const result = await p.send({
//     Tags: [{ name: "Action", value: "Info" }],
//   });
//   console.log(result);
//   assert.equal(response.Messages[0].Data, "hello, world");
// });

// const result = await p.send(undefined, [{ name: "Action", value: "Info" }]);
const result = await p.send("Handlers");
console.log(result.Output.data);
console.log(result.Output.prompt);
console.log(result.Mesages?.[0]);
