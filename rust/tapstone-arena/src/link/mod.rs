//! How MATCH frames reach the mesh: the USB-serial gateway (Task 22), desk mode (in process), and
//! the remote seat riding beside either (0038).
pub mod desk;
pub mod lines;
pub mod radio;
pub mod remote;
#[cfg(feature = "server")]
pub mod serial;
pub mod trace;

/// A frame received from the mesh.
#[derive(Debug, Clone)]
pub struct Rx {
    pub src: u8,
    pub rssi: i8,
    pub mac_ok: bool,
    pub bytes: Vec<u8>,
}

pub trait Link: Send {
    /// Send one frame to `dst` (255 = broadcast).
    fn send(&mut self, dst: u8, frame: &[u8]);
    /// Everything received since the last call, advancing the link's own clock to `now` ms.
    fn poll(&mut self, now: u64) -> Vec<Rx>;
    /// The remote seat riding on this link (0038), if it carries one: the arena loop's one way in,
    /// so the loop is the same with a remote seat and without.
    fn remote(&mut self) -> Option<&mut dyn remote::RemoteSeat> {
        None
    }
}

impl<T: Link + ?Sized> Link for Box<T> {
    fn send(&mut self, dst: u8, frame: &[u8]) {
        (**self).send(dst, frame)
    }
    fn poll(&mut self, now: u64) -> Vec<Rx> {
        (**self).poll(now)
    }
    fn remote(&mut self) -> Option<&mut dyn remote::RemoteSeat> {
        (**self).remote()
    }
}
