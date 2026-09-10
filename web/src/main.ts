import { mount } from "svelte";
import "./app.css";
import "katex/dist/katex.min.css";
import App from "./TemporalApp.svelte";
import TestLab from "./GraphologyTestPage.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("Missing #app mount point");

// Mount by pathname directly — no hash router, so URLs stay clean (/test, not /test/#/test).
const path = window.location.pathname;
const component = path === "/test" ? TestLab : App;

mount(component, { target });
