//! DOM の通知だけでなく、DXGI が合成した画面の明るさを検査する。
use std::fmt::Write as _;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use super::*;

const BACKDROP: u8 = 224;
const PROBE_WIDTH: u32 = 96;
const PROBE_HEIGHT: u32 = 54;

#[derive(Clone)]
struct Sample {
    elapsed_ms: f64,
    brightness: f64,
    image: image::RgbaImage,
}

fn brightness(image: &image::RgbaImage) -> f64 {
    image
        .pixels()
        .map(|pixel| f64::from(pixel[0]) + f64::from(pixel[1]) + f64::from(pixel[2]))
        .sum::<f64>()
        / f64::from(image.width() * image.height() * 3)
}

#[derive(Debug)]
struct FadeMeasurement {
    rebound: f64,
    largest_step: f64,
    intermediate_levels: usize,
    dimming: f64,
}

impl FadeMeasurement {
    fn is_smooth(&self) -> bool {
        self.dimming > 40.0
            && self.rebound <= 8.0
            && self.largest_step <= self.dimming * 0.65
            && self.intermediate_levels >= 3
    }
}

fn measure(values: &[f64]) -> FadeMeasurement {
    let initial = values[0];
    let final_value = values[values.len() - 1];
    let dimming = initial - final_value;
    let mut darkest = initial;
    let mut rebound = 0.0_f64;
    let mut levels = Vec::<f64>::new();
    for &value in values {
        darkest = darkest.min(value);
        rebound = rebound.max(value - darkest);
        if value < initial - dimming * 0.1
            && value > final_value + dimming * 0.1
            && levels
                .iter()
                .all(|previous| (previous - value).abs() >= 2.0)
        {
            levels.push(value);
        }
    }
    FadeMeasurement {
        rebound,
        largest_step: values
            .windows(2)
            .map(|pair| pair[0] - pair[1])
            .fold(0.0, f64::max),
        intermediate_levels: levels.len(),
        dimming,
    }
}

#[test]
fn brightness_detector_accepts_a_fade_and_rejects_a_single_frame_flash() {
    assert!(measure(&[224., 218., 200., 180., 160., 144., 132., 125., 123.]).is_smooth());
    let flashed = measure(&[224., 123., 224., 218., 200., 180., 160., 144., 132., 123.]);
    assert!(!flashed.is_smooth());
    assert_eq!(flashed.rebound, 101.0);
    assert!(!measure(&[224., 123., 123., 123.]).is_smooth());
}

fn write_report(path: &Path, trials: &[Vec<Sample>]) {
    std::fs::create_dir_all(path).unwrap();
    let mut html = String::from(
        "<!doctype html><meta charset=utf-8><title>Overlay flicker trace</title>\
         <style>body{font:16px system-ui;margin:32px;background:#eee;color:#222}\
         svg{display:block;background:white;border:1px solid #aaa}\
         .frames{display:flex;flex-wrap:wrap;gap:8px}figure{margin:0;font-size:12px}\
         img{width:192px;height:108px;border:1px solid #aaa}pre{white-space:pre-wrap}</style>\
         <h1>Overlay flicker trace</h1><p>DXGI desktop frames; only the synthetic backdrop probe is saved.\
         Vertical axis: brightness (0–255). Horizontal axis: milliseconds after capture starts.</p>",
    );
    for (trial, samples) in trials.iter().enumerate() {
        let number = trial + 1;
        let values = samples
            .iter()
            .map(|sample| sample.brightness)
            .collect::<Vec<_>>();
        let measurement = measure(&values);
        let mut csv = String::from("elapsed_ms,brightness\n");
        let duration = samples.last().unwrap().elapsed_ms.max(1.0);
        let mut points = String::new();
        for sample in samples {
            writeln!(csv, "{:.3},{:.3}", sample.elapsed_ms, sample.brightness).unwrap();
            write!(
                points,
                "{:.1},{:.1} ",
                sample.elapsed_ms / duration * 900.0 + 40.0,
                270.0 - sample.brightness,
            )
            .unwrap();
        }
        std::fs::write(path.join(format!("trial-{number:02}.csv")), csv).unwrap();
        write!(html, "<h2>Trial {number}: {}</h2><pre>{measurement:#?}</pre><svg width=960 height=300 viewBox='0 0 960 300'><text x=5 y=15>255</text><text x=5 y=270>0</text><polyline fill=none stroke='#1760a0' stroke-width=2 points='{points}'/><text x=40 y=292>0 ms</text><text x=850 y=292>{duration:.0} ms</text></svg><div class=frames>", if measurement.is_smooth() { "PASS" } else { "FAIL" }).unwrap();
        // 変化したフレームを残す。静止中の同じ画像で証拠を埋めない。
        let mut previous = f64::NAN;
        for (index, sample) in samples.iter().enumerate() {
            if index != 0
                && index + 1 != samples.len()
                && (sample.brightness - previous).abs() < 1.0
            {
                continue;
            }
            previous = sample.brightness;
            let name = format!("trial-{number:02}-frame-{index:03}.png");
            sample.image.save(path.join(&name)).unwrap();
            write!(
                html,
                "<figure><img src='{name}'><figcaption>{:.1} ms / {:.1}</figcaption></figure>",
                sample.elapsed_ms, sample.brightness
            )
            .unwrap();
        }
        html.push_str("</div>");
    }
    std::fs::write(path.join("report.html"), html).unwrap();
}

#[test]
#[ignore = "needs an unlocked Windows desktop; briefly covers the primary monitor with a synthetic backdrop"]
fn region_overlay_fades_without_a_brightness_reversal() {
    assert!(
        !tauri::is_dev(),
        "run pnpm build, then cargo test --release --features native-ui-test,tauri/custom-protocol --lib region_overlay_fades -- --ignored --nocapture --test-threads=1"
    );
    let directory = tempfile::tempdir().unwrap();
    let frontend = Arc::new(FrontendState::default());
    let mut config = Config::default();
    config.capture.auto_copy = AutoCopy::None;
    config.capture.auto_save = false;
    let mut context = tauri::generate_context!();
    context.config_mut().identifier =
        format!("dev.minimalshot.flicker-test-{}", std::process::id());
    let app = tauri::Builder::default()
        .any_thread()
        .manage(frontend.clone())
        .manage(AppState::new(config, directory.path().join("config.toml")))
        .invoke_handler(tauri::generate_handler![
            region_session,
            show_window,
            commands::get_config,
            commands::take_capture_sounds,
            commands::prepare_region,
            region_png,
            region_frame,
            commands::cancel_region,
        ])
        .build(context)
        .unwrap();
    let handle = app.handle().clone();
    let worker = std::thread::spawn(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            windows::prepare_region(&handle).unwrap();
            wait_for("prewarmed region frontend", || {
                frontend
                    .ready
                    .lock()
                    .unwrap()
                    .contains(windows::REGION_LABEL)
            });
            let primary = handle.primary_monitor().unwrap().unwrap();
            let bounds = ScreenBounds {
                x: primary.position().x,
                y: primary.position().y,
                width: primary.size().width,
                height: primary.size().height,
            };
            // 背景は WebView を使わない。検査対象以外の描画タイミングを混ぜない。
            let backdrop = tauri::window::WindowBuilder::new(&handle, "flicker-backdrop")
                .title("MinimalShot flicker test — synthetic backdrop")
                .decorations(false)
                .shadow(false)
                .background_color(tauri::window::Color(BACKDROP, BACKDROP, BACKDROP, 255))
                .visible(false)
                .build()
                .unwrap();
            backdrop
                .set_position(tauri::PhysicalPosition::new(bounds.x, bounds.y))
                .unwrap();
            backdrop
                .set_size(tauri::PhysicalSize::new(bounds.width, bounds.height))
                .unwrap();
            backdrop.show().unwrap();
            backdrop.set_focus().unwrap();
            let monitor = xcap::Monitor::from_point(
                bounds.x + bounds.width as i32 / 2,
                bounds.y + bounds.height as i32 / 2,
            )
            .unwrap();
            let probe_x = bounds.width / 2 - PROBE_WIDTH / 2;
            let probe_y = bounds.height * 3 / 4 - PROBE_HEIGHT / 2;
            wait_for("uniform synthetic backdrop", || {
                let image = monitor
                    .capture_region(probe_x, probe_y, PROBE_WIDTH, PROBE_HEIGHT)
                    .unwrap();
                image.pixels().all(|pixel| {
                    pixel.0[..3]
                        .iter()
                        .all(|value| value.abs_diff(BACKDROP) <= 2)
                })
            });
            let (recorder, receiver) = monitor.video_recorder().unwrap();
            let samples = Arc::new(Mutex::new(Vec::<Sample>::new()));
            let recording = Arc::new(AtomicBool::new(true));
            let started = Instant::now();
            let collected = samples.clone();
            let running = recording.clone();
            let collector = std::thread::spawn(move || {
                while running.load(Ordering::Relaxed) {
                    let Ok(frame) = receiver.recv_timeout(Duration::from_millis(100)) else {
                        continue;
                    };
                    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
                    let desktop = image::RgbaImage::from_raw(frame.width, frame.height, frame.raw)
                        .expect("invalid DXGI frame");
                    let image = image::imageops::crop_imm(
                        &desktop,
                        probe_x,
                        probe_y,
                        PROBE_WIDTH,
                        PROBE_HEIGHT,
                    )
                    .to_image();
                    collected.lock().unwrap().push(Sample {
                        elapsed_ms,
                        brightness: brightness(&image),
                        image,
                    });
                }
            });
            recorder.start().unwrap();
            wait_for("first DXGI frame", || !samples.lock().unwrap().is_empty());
            let region = handle.get_webview_window(windows::REGION_LABEL).unwrap();
            let mut trials = Vec::new();
            for (trial, hidden_ms) in [50, 50, 250, 1000, 50, 2000, 50, 5000]
                .into_iter()
                .enumerate()
            {
                std::thread::sleep(Duration::from_millis(hidden_ms));
                wait_for("backdrop restored after cancel", || {
                    samples.lock().unwrap().last().is_some_and(|sample| {
                        (sample.brightness - f64::from(BACKDROP)).abs() <= 2.0
                    })
                });
                let (first, mut baseline) = {
                    let samples = samples.lock().unwrap();
                    (samples.len(), samples.last().unwrap().clone())
                };
                let trigger_ms = started.elapsed().as_secs_f64() * 1000.0;
                baseline.elapsed_ms = 0.0;
                *frontend.region_started.lock().unwrap() = Some(Instant::now());
                actions::start_capture(&handle, crate::state::CaptureKind::Region).unwrap();
                wait_for("region presentation", || {
                    frontend.region_shows.lock().unwrap().len() == trial + 1
                });
                std::thread::sleep(Duration::from_millis(650));
                let mut frames = vec![baseline];
                frames.extend(samples.lock().unwrap()[first..].iter().cloned().map(
                    |mut sample| {
                        sample.elapsed_ms -= trigger_ms;
                        sample
                    },
                ));
                let measurement = measure(
                    &frames
                        .iter()
                        .map(|sample| sample.brightness)
                        .collect::<Vec<_>>(),
                );
                eprintln!(
                    "trial {} (hidden {hidden_ms} ms), {} desktop frames: {measurement:?}",
                    trial + 1,
                    frames.len()
                );
                trials.push(frames);
                commands::cancel_region(region.clone(), handle.state()).unwrap();
            }
            recorder.stop().unwrap();
            recording.store(false, Ordering::Relaxed);
            collector.join().unwrap();
            let output = std::env::var_os("MINIMALSHOT_FLICKER_ARTIFACTS")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| {
                    std::env::temp_dir().join(format!("minimalshot-flicker-{}", std::process::id()))
                });
            write_report(&output, &trials);
            eprintln!("Flicker report: {}", output.join("report.html").display());
            let failures = trials
                .iter()
                .enumerate()
                .filter_map(|(index, samples)| {
                    let measurement = measure(
                        &samples
                            .iter()
                            .map(|sample| sample.brightness)
                            .collect::<Vec<_>>(),
                    );
                    (!measurement.is_smooth()).then_some((index + 1, measurement))
                })
                .collect::<Vec<_>>();
            assert!(
                failures.is_empty(),
                "visible overlay flash or skipped fade: {failures:#?}"
            );
        }));
        handle.exit(0);
        result
    });
    assert_eq!(app.run_return(|_, _| {}), 0);
    if let Err(error) = worker.join().unwrap() {
        std::panic::resume_unwind(error);
    }
}
