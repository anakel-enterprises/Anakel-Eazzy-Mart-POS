import { app } from "./app.js";
import { env } from "./lib/env.js";

app.listen(env.port, () => {
  console.log(`Anakel Eazzy Mart POS API listening on http://localhost:${env.port}`);
});
