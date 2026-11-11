// Filmed readings of whole books that their publishers share for embedding.
// Only official uploads belong here: a copy of a commercial audiobook
// uploaded by someone else can be taken down and leave a dead player.
export const BOOK_VIDEOS = Object.freeze([
  {
    book: 'john',
    youtube: 'https://www.youtube.com/watch?v=PKiAXVxOm6o',
    title: 'The Gospel according to St John',
    reader: 'Sir David Suchet',
    translation: 'NIV (Anglicised)',
    publisher: 'Westminster Abbey',
    minutes: 144,
    note: 'Filmed in the Jerusalem Chamber, where the King James translators met in 1611.'
  }
]);

export const videosForBook = slug => BOOK_VIDEOS.filter(video => video.book === slug);
