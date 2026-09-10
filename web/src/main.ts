import { mount } from "svelte";
import "./app.css";
import "katex/dist/katex.min.css";
import App from "./TemporalApp.svelte";
import TestLab from "./GraphologyTestPage.svelte";
import SigmaV4CompatibilityPage from "./SigmaV4CompatibilityPage.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("Missing #app mount point");

// Mount by pathname directly — no hash router, so URLs stay clean (/test, not /test/#/test).
const path = window.location.pathname;
const component = path === "/test" ? TestLab : path === "/sigma-v4-spike" ? SigmaV4CompatibilityPage : App;

mount(component, { target });
