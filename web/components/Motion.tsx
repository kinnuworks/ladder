"use client";
import { useEffect } from "react";

/** Reveal-on-scroll for `.reveal` elements and the fill of `.range` sliders. */
export function Motion() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll(".reveal"));
    let io: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver(
        (es) =>
          es.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add("in");
              io?.unobserve(e.target);
            }
          }),
        { rootMargin: "0px 0px -8% 0px" },
      );
      els.forEach((el) => io!.observe(el));
    } else {
      els.forEach((el) => el.classList.add("in"));
    }
    return () => io?.disconnect();
  }, []);
  return null;
}
