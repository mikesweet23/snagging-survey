# Site Survey

A small, phone friendly progressive web app for recording site survey and snagging items.

## What it does

- Create and reopen surveys with a survey date, site name and surveyor.
- Take a photo on site or choose a photo already on the device.
- Draw directly on photos to point out the detail that needs attention.
- Add a room or area, observation and comments, action owner and due date to each item.
- Export a print ready report designed for two items per A4 page. In the print dialog, choose **Save as PDF**.
- Keep working offline after the first load. Reports and photos are stored in the browser on the device; there is no sign in or cloud sync.

## Run it

Serve this folder from a local web server, or publish it on a static HTTPS host. Service workers and installable PWAs require HTTPS, except on `localhost`.

For a quick local preview, run a static server in this folder and open its local address in a browser. On a phone, open the HTTPS address and use the browser's **Add to Home Screen** or **Install app** option.

## Data note

Surveys are stored in IndexedDB in the current browser profile. Clearing the browser's site data removes saved surveys. Export the report as PDF to keep a shareable copy.
