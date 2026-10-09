use std::collections::HashMap;

/// 表示済みの窓とは別に、初期化済みの予備を最大1枚保持する。
/// 窓の番号と画像IDは独立させ、予備に画像が無い間は IPC で取得させない。
#[derive(Default)]
pub struct ViewerPool {
    next_id: u32,
    spare: Option<(String, bool)>,
    shots: HashMap<String, u32>,
}

impl ViewerPool {
    pub fn new_label(&mut self) -> String {
        self.next_id += 1;
        format!("viewer-{}", self.next_id)
    }

    pub fn reserve_spare(&mut self) -> Option<String> {
        if self.spare.is_some() {
            return None;
        }
        let label = self.new_label();
        self.spare = Some((label.clone(), false));
        Some(label)
    }

    pub fn spare_created(&mut self, label: &str) {
        if let Some((reserved, ready)) = &mut self.spare {
            if reserved == label {
                *ready = true;
            }
        }
    }

    pub fn take_spare(&mut self) -> Option<String> {
        if !self.spare.as_ref().is_some_and(|(_, ready)| *ready) {
            return None;
        }
        self.spare.take().map(|(label, _)| label)
    }

    pub fn bind(&mut self, label: String, id: u32) {
        self.shots.insert(label, id);
    }

    pub fn shot_id(&self, label: &str) -> Option<u32> {
        self.shots.get(label).copied()
    }

    pub fn remove(&mut self, label: &str) -> Option<u32> {
        if self.spare.as_ref().is_some_and(|(spare, _)| spare == label) {
            self.spare = None;
        }
        self.shots.remove(label)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_one_spare_can_be_prepared_and_it_cannot_be_used_during_creation() {
        let mut pool = ViewerPool::default();
        let label = pool.reserve_spare().unwrap();
        assert!(pool.reserve_spare().is_none());
        assert!(pool.take_spare().is_none());
        assert_eq!(pool.shot_id(&label), None);
        pool.spare_created(&label);
        assert_eq!(pool.take_spare(), Some(label));
        assert!(pool.take_spare().is_none());
        assert!(pool.reserve_spare().is_some());
    }

    #[test]
    fn captures_during_preparation_keep_separate_image_bindings() {
        let mut pool = ViewerPool::default();
        let spare = pool.reserve_spare().unwrap();
        let immediate = pool.new_label();
        pool.bind(immediate.clone(), 1);
        pool.spare_created(&spare);
        let claimed = pool.take_spare().unwrap();
        pool.bind(claimed.clone(), 2);
        assert_eq!(pool.shot_id(&immediate), Some(1));
        assert_eq!(pool.shot_id(&claimed), Some(2));
        assert_eq!(pool.remove(&immediate), Some(1));
        assert_eq!(pool.shot_id(&claimed), Some(2));
    }

    #[test]
    fn failed_or_destroyed_spare_can_be_replaced() {
        let mut pool = ViewerPool::default();
        let label = pool.reserve_spare().unwrap();
        assert_eq!(pool.remove(&label), None);
        let replacement = pool.reserve_spare().unwrap();
        assert_ne!(label, replacement);
        pool.spare_created(&label);
        assert!(pool.take_spare().is_none());
    }
}
