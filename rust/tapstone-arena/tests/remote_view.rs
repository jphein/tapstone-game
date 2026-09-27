//! The join code rides in the view while joining is open (spec §2), and is absent otherwise, so a
//! table without a remote seat serialises exactly as before (the desk fixture guards that).
use tapstone_arena::view::ViewModel;

#[test]
fn the_join_code_rides_in_the_view_only_when_there_is_one() {
    let mut v = ViewModel::default();
    assert!(!serde_json::to_string(&v).unwrap().contains("remote_code"));
    v.remote_code = Some("K7Q2MX".into());
    assert!(
        serde_json::to_string(&v)
            .unwrap()
            .contains(r#""remote_code":"K7Q2MX""#)
    );
}
