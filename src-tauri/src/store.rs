use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

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
    shots: HashMap<u32, Arc<Mutex<Shot>>>,
}

impl ShotStore {
    pub fn insert(&self, image: RgbaImage) -> u32 {
        let mut inner = self.inner.lock().unwrap();
        inner.next_id += 1;
        let id = inner.next_id;
        inner.shots.insert(
            id,
            Arc::new(Mutex::new(Shot {
                image,
                saved_path: None,
            })),
        );
        id
    }

    pub fn get(&self, id: u32) -> AppResult<Arc<Mutex<Shot>>> {
        self.inner
            .lock()
            .unwrap()
            .shots
            .get(&id)
            .cloned()
            .ok_or_else(|| AppError::msg(format!("キャプチャ {id} が見つかりません")))
    }

    pub fn with<T>(&self, id: u32, f: impl FnOnce(&mut Shot) -> AppResult<T>) -> AppResult<T> {
        let shot = self.get(id)?;
        let mut shot = shot.lock().unwrap();
        f(&mut shot)
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

    #[test]
    fn background_work_retains_a_closed_shot_without_blocking_other_shots() {
        let store = ShotStore::default();
        let first = store.insert(RgbaImage::new(1, 1));
        let second = store.insert(RgbaImage::new(2, 2));
        let background = store.get(first).unwrap();
        let mut saving = background.lock().unwrap();
        // 保存中の1枚をロックしても、別の画像の表示や閉じる処理は待たない。
        assert_eq!(
            store.with(second, |shot| Ok(shot.image.width())).unwrap(),
            2
        );
        store.remove(first);
        saving.saved_path = Some(PathBuf::from("saved.png"));
        drop(saving);
        assert_eq!(
            background.lock().unwrap().saved_path,
            Some(PathBuf::from("saved.png"))
        );
        assert!(store.get(first).is_err());
    }
}
