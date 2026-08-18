import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import TestLab from "./GraphologyTestPage.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("Missing #app mount point");

// Handle direct path navigation by redirecting to hash URL
// svelte-spa-router uses hash-based routing
const path = window.location.pathname;
if (path === "/test") {
  window.location.hash = "#/test";
} else if (path !== "/") {
  window.location.hash = "#/";
}

// Import Router after setting up hash redirect
import Router from "svelte-spa-router";

const routes = {
  "/": App,
  "/test": TestLab,
};

mount(Router, { target, props: { routes } });