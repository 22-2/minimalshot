use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use image::RgbaImage;

use crate::error::{AppError, AppResult};

/// 画面上に出ている1枚のキャプチャ。保存するまではメモリ上にだけ存在する。
pub struct Shot {
    pub image: RgbaImage,
    pub saved_path: Option<PathBuf>,
}

/// ビューアウィンドウ1枚につき1件のキャプチャを保持する。
#[derive(Default)]
pub struct ShotStore {
    inner: Mutex<StoreInner>,
}

#[derive(Default)]
struct StoreInner {
    next_id: u32,
    shots: HashMap<u32, Shot>,
}

impl ShotStore {
    pub fn insert(&self, image: RgbaImage) -> u32 {
        let mut inner = self.inner.lock().unwrap();
        inner.next_id += 1;
        let id = inner.next_id;
        inner.shots.insert(
            id,
            Shot {
                image,
                saved_path: None,
            },
        );
        id
    }

    pub fn with<T>(&self, id: u32, f: impl FnOnce(&mut Shot) -> AppResult<T>) -> AppResult<T> {
        let mut inner = self.inner.lock().unwrap();
        let shot = inner
            .shots
            .get_mut(&id)
            .ok_or_else(|| AppError::msg(format!("キャプチャ {id} が見つかりません")))?;
        f(shot)
    }

    pub fn remove(&self, id: u32) {
        self.inner.lock().unwrap().shots.remove(&id);
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.inner.lock().unwrap().shots.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assigns_unique_ids_and_removes() {
        let store = ShotStore::default();
        let a = store.insert(RgbaImage::new(1, 1));
        let b = store.insert(RgbaImage::new(2, 2));
        assert_ne!(a, b);
        assert_eq!(store.len(), 2);

        let width = store.with(b, |shot| Ok(shot.image.width())).unwrap();
        assert_eq!(width, 2);

        store.remove(a);
        assert_eq!(store.len(), 1);
        assert!(store.with(a, |_| Ok(())).is_err());
    }
}
