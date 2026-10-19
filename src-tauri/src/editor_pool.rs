use std::collections::HashMap;

/// エディタウィンドウ1枚につき1件の画像コピーを割り当てる。
/// ビューアの画像を共有すると、ビューアを閉じたときに編集中の画像まで消えるため独立させる。
#[derive(Default)]
pub struct EditorPool {
    next_id: u32,
    shots: HashMap<String, u32>,
}

impl EditorPool {
    pub fn new_label(&mut self) -> String {
        self.next_id += 1;
        format!("editor-{}", self.next_id)
    }

    pub fn bind(&mut self, label: String, id: u32) {
        self.shots.insert(label, id);
    }

    pub fn shot_id(&self, label: &str) -> Option<u32> {
        self.shots.get(label).copied()
    }

    pub fn remove(&mut self, label: &str) -> Option<u32> {
        self.shots.remove(label)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assigns_unique_labels_and_tracks_independent_images() {
        let mut pool = EditorPool::default();
        let first = pool.new_label();
        let second = pool.new_label();
        assert_ne!(first, second);
        pool.bind(first.clone(), 1);
        pool.bind(second.clone(), 2);
        assert_eq!(pool.shot_id(&first), Some(1));
        assert_eq!(pool.shot_id(&second), Some(2));
        assert_eq!(pool.remove(&first), Some(1));
        assert_eq!(pool.shot_id(&first), None);
        assert_eq!(pool.shot_id(&second), Some(2));
    }

    #[test]
    fn removing_an_unbound_label_is_harmless() {
        let mut pool = EditorPool::default();
        let label = pool.new_label();
        assert_eq!(pool.remove(&label), None);
        assert_eq!(pool.shot_id(&label), None);
    }
}
